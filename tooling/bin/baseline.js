#!/usr/bin/env node
import { basename, resolve } from 'node:path';
import { computeChanges } from '../src/apply.js';
import { auditRepo, renderAudit } from '../src/audit.js';
import { loadBaseline } from '../src/config.js';
import { hygieneForRepo, renderDeps, versionSkew } from '../src/deps.js';
import { baselinedPaths, discover, renderDiscover } from '../src/discover.js';
import { enumerateEstate } from '../src/estate.js';
import { inspect } from '../src/inspect.js';
import { plan, renderMarkdown } from '../src/plan.js';
import {
    cloneToTemp,
    commitOnBranch,
    defaultBranch,
    diffStat,
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
  baseline apply    <repoPath> --profile <name>   Apply auto-fixes on a throwaway clone (local only)

Options:
  --profile <name>   Profile to inspect against (default: node-service)
  --json             Emit JSON instead of markdown
  --org <name>       Org for metadata substitution (default: CriminalInjuriesCompensationAuthority)

Notes:
  'apply' never touches the source repo or the network. It clones to a temp dir, applies only the
  auto-applicable (create/replace/merge) changes on a 'baseline/adopt-<version>' branch, and commits
  locally. Pushing + PR creation are intentionally out of scope (need GitHub auth).
`;

/**
 * Minimal arg parser: positional command + path, plus --flags.
 *
 * @param {string[]} argv
 * @returns {{ command?: string, repoPath?: string, profile: string, json: boolean }}
 */
function parseArgs(argv) {
    const positionals = [];
    let profile = 'node-service';
    let json = false;
    let org = 'CriminalInjuriesCompensationAuthority';
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--profile') {
            profile = argv[++i];
        } else if (arg === '--org') {
            org = argv[++i];
        } else if (arg === '--json') {
            json = true;
        } else {
            positionals.push(arg);
        }
    }
    return { command: positionals[0], repoPath: positionals[1], profile, json, org };
}

function main() {
    const { command, repoPath, profile, json, org } = parseArgs(process.argv.slice(2));

    const known = ['inspect', 'plan', 'audit', 'discover', 'deps', 'apply'];
    if (!command || !repoPath || !known.includes(command)) {
        process.stdout.write(USAGE);
        process.exit(command ? 1 : 0);
    }

    const baseline = loadBaseline();

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
        const planned = plan(inspection);
        const baselineVersion = baseline.config.baselineVersion ?? '0.0.0';
        // Resolve CODEOWNERS owners from the org-aware codeowners map (GitHub honours
        // only teams in the repo's own org). Falls back to empty if the org is unmapped.
        const owners = baseline.config.codeowners?.[org] ?? [];
        const vars = {
            ORG: org,
            REPO: basename(repoRoot),
            OWNERS: owners.join(' '),
            YEAR: String(new Date().getFullYear()),
            ADOPTED_AT: new Date().toISOString().slice(0, 10),
            BASELINE_VERSION: baselineVersion,
            BASELINE_REF: baseline.config.ciReusableRef ?? 'v1',
            CI_WORKDIR: '.',
            PORT: '5000',
            START_CMD: './bin/www',
            MAIN_ENTRY: 'src/index.js',
            BUILD_CMD: 'node ./src/build.js'
        };

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
            org,
            adoptedAt: vars.ADOPTED_AT
        });
        const result = commitOnBranch(clone, {
            branch,
            message: `chore: adopt project-baseline ${baselineVersion} (${profile})`
        });

        const report = [
            `# Applied (local only) — ${basename(repoRoot)}`,
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
            diffStat(clone, base),
            '```',
            '',
            '> Local only — nothing was pushed. Review the clone, then push + open a PR when ready.'
        ].join('\n');

        process.stdout.write(
            json
                ? `${JSON.stringify({ clone, branch, result, changes: changes.map((c) => ({ path: c.path, action: c.action })), skippedManual, demotedToManual, demotedReasons }, null, 2)}\n`
                : `${report}\n`
        );
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
