#!/usr/bin/env node
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildVars, computeChanges } from '../src/apply.js';
import { auditRepo, renderAudit } from '../src/audit.js';
import { findBaselineRoot, loadBaseline } from '../src/config.js';
import { hygieneForRepo, renderDeps, versionSkew } from '../src/deps.js';
import { baselinedPaths, discover, renderDiscover } from '../src/discover.js';
import { enumerateEstate } from '../src/estate.js';
import { inspect } from '../src/inspect.js';
import { plan, renderMarkdown } from '../src/plan.js';
import {
    buildPrBody,
    buildPrTitle,
    parseGitHubRemote,
    publishAdoption,
    redactUrl,
    resolveRepoIdentity
} from '../src/publish.js';
import {
    cloneToTemp,
    commitOnBranch,
    defaultBranch,
    diffStat,
    gitIdentity,
    hasUncommittedChanges,
    remoteUrl,
    writeChanges,
    writeMetadata
} from '../src/workspace.js';

const USAGE = `baseline — project-baseline tooling

Usage:
  baseline inspect  <repoPath> --profile <name>   Read-only inspection (JSON)
  baseline plan     <repoPath> --profile <name>   Adoption plan (markdown)
  baseline audit    <parentDir>                    Estate audit across repos (markdown tracker)
  baseline discover <parentDir>                    Shared-file frequency + candidate additions
  baseline deps     <parentDir>                    Dependency-hygiene report
  baseline apply    <repoPath> --profile <name>   Apply auto-fixes on a throwaway clone
                                                  (local only; add --push to open a PR)

Options:
  --profile <name>   Profile to inspect against (default: node-service)
  --json             Emit JSON instead of markdown
  --org <name>       Org for metadata substitution (default: the owner of the repo's GitHub
                     origin, else CriminalInjuriesCompensationAuthority)

apply options:
  --push             Push the adoption branch to the repo's GitHub 'origin' and open a PR
                     (uses your local 'gh' login). Never force-pushes.
  --dry-run          With --push: run every safety check, push and open nothing.
  --draft            With --push: open the PR as a draft.

Notes:
  'apply' never touches the source repo. It clones to a temp dir, applies only the
  auto-applicable (create/replace/merge) changes on a 'baseline/adopt-<version>' branch, and commits
  locally. Without --push it never touches the network.
  --push refuses if: origin is not a GitHub remote, tracked files have uncommitted changes (they would
  leak into merged files), the remote lacks the base branch, the local branch has commits that are not
  on the remote, or the adoption branch already exists remotely without an open PR.
`;

/**
 * Minimal arg parser: positional command + path, plus --flags.
 *
 * @param {string[]} argv
 * @returns {{ command?: string, repoPath?: string, profile: string, json: boolean, org: string,
 *   orgExplicit: boolean, push: boolean, draft: boolean, dryRun: boolean }}
 */
function parseArgs(argv) {
    const positionals = [];
    let profile = 'node-service';
    let json = false;
    let push = false;
    let draft = false;
    let dryRun = false;
    let org = 'CriminalInjuriesCompensationAuthority';
    let orgExplicit = false;
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--profile') {
            profile = argv[++i];
        } else if (arg === '--org') {
            org = argv[++i];
            orgExplicit = true;
        } else if (arg === '--json') {
            json = true;
        } else if (arg === '--push') {
            push = true;
        } else if (arg === '--draft') {
            draft = true;
        } else if (arg === '--dry-run') {
            dryRun = true;
        } else {
            positionals.push(arg);
        }
    }
    return {
        command: positionals[0],
        repoPath: positionals[1],
        profile,
        json,
        org,
        orgExplicit,
        push,
        draft,
        dryRun
    };
}

/**
 * Prints an error to stderr and exits non-zero.
 *
 * @param {string} message
 * @returns {never}
 */
function fail(message) {
    process.stderr.write(`error: ${message}\n`);
    process.exit(1);
}

/**
 * One-line outcome shown at the bottom of the apply report.
 *
 * @param {object} args
 * @returns {string}
 */
function describePublish({ push, published, publishError, base, target }) {
    if (!push) {
        return '> Local only — nothing was pushed. Review the clone, then push + open a PR when ready (or re-run with --push).';
    }
    if (publishError) {
        return '> Publishing FAILED (see the error below). Nothing was merged; the clone is kept for inspection.';
    }
    switch (published.status) {
        case 'created':
            return `> Pushed \`${published.branch}\` to ${target.slug} and opened a PR: ${published.url}`;
        case 'exists':
            return `> \`${published.branch}\` already has an open PR, so nothing was pushed: ${published.url}`;
        case 'dry-run':
            return `> Dry run: every check passed. Would push \`${published.branch}\` to ${target.slug} and open a PR against \`${base}\`. Nothing was pushed.`;
        default:
            return '> Nothing to publish: no changes were needed.';
    }
}

function main() {
    const { command, repoPath, profile, json, org, orgExplicit, push, draft, dryRun } = parseArgs(
        process.argv.slice(2)
    );

    const known = ['inspect', 'plan', 'audit', 'discover', 'deps', 'apply'];
    if (!command || !repoPath || !known.includes(command)) {
        process.stdout.write(USAGE);
        process.exit(command ? 1 : 0);
    }

    if ((push || draft || dryRun) && command !== 'apply') {
        fail('--push, --draft and --dry-run only apply to the "apply" command.');
    }
    if ((draft || dryRun) && !push) {
        fail('--draft and --dry-run only make sense together with --push.');
    }
    // Locate the baseline relative to THIS script, not the current directory, so the CLI works when
    // run from inside the repo being adopted (e.g. `node /path/to/baseline.js apply . --push`).
    const baseline = loadBaseline(findBaselineRoot(dirname(fileURLToPath(import.meta.url))));

    if (command === 'discover') {
        const parentDir = resolve(repoPath);
        const repos = enumerateEstate(parentDir, { exclude: ['project-baseline'] }).filter(
            (r) => r.scope.inScope
        );
        const result = discover({ repos, baselined: baselinedPaths(baseline.filePolicy) });
        process.stdout.write(
            json ? `${JSON.stringify(result, null, 2)}\n` : renderDiscover(result)
        );
        return;
    }

    if (command === 'deps') {
        const parentDir = resolve(repoPath);
        const repos = enumerateEstate(parentDir, { exclude: ['project-baseline'] }).filter(
            (r) => r.scope.inScope
        );
        const perRepo = repos.map((r) => ({ name: r.name, hygiene: hygieneForRepo(r.dir) }));
        const repoDeps = perRepo
            .filter((r) => r.hygiene)
            .map((r) => ({ name: r.name, declared: r.hygiene.declared }));
        const skew = versionSkew(repoDeps);
        process.stdout.write(
            json ? `${JSON.stringify({ perRepo, skew }, null, 2)}\n` : renderDeps(perRepo, skew)
        );
        return;
    }

    if (command === 'audit') {
        const parentDir = resolve(repoPath);
        const rows = enumerateEstate(parentDir, { exclude: ['project-baseline'] }).map((repo) => {
            if (!repo.scope.inScope) {
                return repo;
            }
            const result = auditRepo({ repoRoot: repo.dir, profile: repo.profile, baseline });
            return { ...repo, result };
        });
        if (json) {
            process.stdout.write(
                `${JSON.stringify(
                    rows.map((r) => ({
                        name: r.name,
                        profile: r.profile,
                        scope: r.scope,
                        columns: r.result?.columns
                    })),
                    null,
                    2
                )}\n`
            );
        } else {
            process.stdout.write(renderAudit(rows));
        }
        return;
    }

    const repoRoot = resolve(repoPath);
    const inspection = inspect({ repoRoot, profile, baseline });

    if (command === 'apply') {
        // --push pre-flight, BEFORE doing any work: fail fast on things we can know up front.
        let target = null;
        if (push) {
            const originUrl = remoteUrl(repoRoot);
            if (!originUrl) {
                fail('--push needs the repo to have an "origin" remote, and it has none.');
            }
            const parsed = parseGitHubRemote(originUrl);
            if (!parsed) {
                fail(`--push only supports GitHub remotes; origin is ${redactUrl(originUrl)}.`);
            }
            if (hasUncommittedChanges(repoRoot)) {
                fail(
                    'The repo has uncommitted changes to tracked files. Merges are computed from the ' +
                        'working tree but committed onto the last commit, so those edits would leak ' +
                        'into the PR. Commit or stash them, then retry.'
                );
            }
            target = { originUrl, slug: `${parsed.owner}/${parsed.repo}` };
        }

        const planned = plan(inspection);
        const baselineVersion = baseline.config.baselineVersion ?? '0.0.0';
        // Placeholder values for templates. DEFAULT_BRANCH is read from the target repo so the CI
        // caller triggers on the branch the repo actually uses (master vs main).
        // Real org + repo name come from the GitHub origin, not the folder name or the default org:
        // links (SECURITY.md) and CODEOWNERS owners (looked up per org) must match the actual repo.
        const identity = resolveRepoIdentity(remoteUrl(repoRoot), {
            explicitOrg: orgExplicit ? org : undefined,
            folderName: basename(repoRoot),
            defaultOrg: org
        });
        const vars = buildVars({
            repoRoot,
            repoName: identity.repoName,
            baseline,
            org: identity.org,
            defaultBranch: defaultBranch(repoRoot)
        });

        const { changes, skippedManual, demotedToManual, demotedReasons } = computeChanges({
            planned,
            baseline,
            repoRoot,
            profile,
            vars
        });

        // Safety: operate on a throwaway clone, never the source repo.
        const clone = cloneToTemp(repoRoot, basename(repoRoot));
        const base = defaultBranch(clone);
        const branch = `baseline/adopt-${baselineVersion}`;
        writeChanges(clone, changes);
        writeMetadata(clone, {
            baselineVersion,
            profile,
            org: identity.org,
            adoptedAt: vars.ADOPTED_AT
        });
        const result = commitOnBranch(clone, {
            branch,
            message: `chore: adopt project-baseline ${baselineVersion} (${profile})`,
            // Commits may be pushed, so attribute them to the person running this, not a placeholder.
            identity: gitIdentity(repoRoot)
        });
        const stat = diffStat(clone, base);

        // Publish (opt-in). A failure must not hide the report, so capture it and report afterwards.
        let published = null;
        let publishError = null;
        if (push) {
            if (result.filesChanged === 0) {
                published = { status: 'nothing-to-publish', branch };
            } else {
                try {
                    published = publishAdoption({
                        clone,
                        branch,
                        base,
                        slug: target.slug,
                        pushUrl: target.originUrl,
                        title: buildPrTitle({ baselineVersion, profile }),
                        body: buildPrBody({
                            repoName: identity.repoName,
                            profile,
                            baselineVersion,
                            base,
                            branch,
                            changes,
                            skippedManual,
                            demotedToManual,
                            demotedReasons,
                            diffStat: stat
                        }),
                        draft,
                        dryRun
                    });
                } catch (err) {
                    publishError = err;
                }
            }
        }

        const footer = describePublish({ push, published, publishError, base, target });

        const report = [
            `# Applied${push ? '' : ' (local only)'} — ${identity.repoName}`,
            '',
            `- Clone: ${clone}`,
            `- Branch: ${result.branch} (base: ${base})`,
            `- Commit: ${result.commit}`,
            `- Files changed: ${result.filesChanged}`,
            '',
            '## Auto-applied',
            ...changes.map(
                (c) => `- ${c.action}: \`${c.path}\`${c.detail ? ` (${c.detail})` : ''}`
            ),
            '',
            '## Left for manual review',
            ...skippedManual.map((p) => `- \`${p}\``),
            ...demotedToManual.map(
                (p) => `- \`${p}\` (${demotedReasons[p] ?? 'no baseline source / unmergeable'})`
            ),
            '',
            '## Diff stat',
            '```',
            stat,
            '```',
            '',
            footer
        ].join('\n');

        process.stdout.write(
            json
                ? `${JSON.stringify({ clone, branch, result, changes: changes.map((c) => ({ path: c.path, action: c.action })), skippedManual, demotedToManual, demotedReasons, published, publishError: publishError ? redactUrl(publishError.message) : null }, null, 2)}\n`
                : `${report}\n`
        );
        if (publishError) {
            process.stderr.write(`\nerror: ${redactUrl(publishError.message)}\n`);
            process.exit(1);
        }
        return;
    }

    if (command === 'inspect') {
        const out = inspection.files.map((f) => ({ path: f.path, state: f.state }));
        process.stdout.write(
            `${JSON.stringify({ profile, files: out, migrations: inspection.migrations.map((m) => ({ id: m.id, applies: m.applies })) }, null, 2)}\n`
        );
        return;
    }

    const p = plan(inspection);
    if (json) {
        process.stdout.write(`${JSON.stringify(p, null, 2)}\n`);
    } else {
        process.stdout.write(renderMarkdown(p, { repoName: basename(repoRoot) }));
    }
}

main();
