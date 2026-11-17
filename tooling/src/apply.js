import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { resolvedFileEntries } from './config.js';
import { mergePackageScripts } from './packageScripts.js';

/**
 * Builds the `{{PLACEHOLDER}}` substitution map applied to baseline templates.
 *
 * Every placeholder a template uses must be supplied here (a test enforces this), so a template can
 * never be written out with an unresolved `{{TOKEN}}`.
 *
 * @param {object} args
 * @param {string} args.repoRoot Absolute path of the target repo.
 * @param {string} [args.repoName] The repo's real name (from its GitHub remote). A checkout can live
 *   in any folder, so this wins over the folder name, which is only the fallback for REPO.
 * @param {{ config: object }} args.baseline Loaded baseline.
 * @param {string} args.org GitHub org of the target repo.
 * @param {string} args.defaultBranch The target repo's default branch (used by CI triggers).
 * @param {Date} [args.now] Clock, injectable for tests.
 * @returns {Record<string, string>}
 */
export function buildVars({ repoRoot, repoName, baseline, org, defaultBranch, now = new Date() }) {
    const { config } = baseline;
    // CODEOWNERS owners are org-aware: GitHub honours only teams in the repo's own org.
    const owners = config.codeowners?.[org] ?? [];
    return {
        ORG: org,
        REPO: repoName ?? basename(repoRoot),
        OWNERS: owners.join(' '),
        YEAR: String(now.getFullYear()),
        ADOPTED_AT: now.toISOString().slice(0, 10),
        BASELINE_VERSION: config.baselineVersion ?? '0.0.0',
        BASELINE_REF: config.ciReusableRef ?? 'v1',
        DEFAULT_BRANCH: defaultBranch,
        CI_WORKDIR: '.',
        PORT: '5000',
        START_CMD: './bin/www',
        MAIN_ENTRY: 'src/index.js',
        BUILD_CMD: 'node ./src/build.js'
    };
}

/**
 * Substitutes {{PLACEHOLDER}} tokens in template content.
 *
 * @param {string} content Template content.
 * @param {Record<string,string>} vars Substitution map (keys without braces).
 * @returns {string} Content with placeholders replaced.
 */
export function substitute(content, vars) {
    return content.replace(/\{\{(\w+)\}\}/g, (match, key) =>
        Object.hasOwn(vars, key) ? vars[key] : match
    );
}

/**
 * Merges .gitignore by union of lines: all existing lines kept, baseline lines
 * appended if not already present. Never removes an existing entry.
 *
 * @param {string} existing Current repo file content.
 * @param {string} baseline Baseline file content.
 * @returns {string} Merged content.
 */
export function mergeGitignore(existing, baseline) {
    const existingLines = existing.split('\n');
    const present = new Set(existingLines.map((l) => l.trim()).filter(Boolean));
    const additions = baseline
        .split('\n')
        .map((l) => l.trim())
        // Only add genuinely-new ignore entries. Skip blanks, and skip comment
        // lines (they carry no ignore behaviour and would otherwise orphan when
        // their entries are already present).
        .filter((l) => l && !l.startsWith('#') && !present.has(l));
    if (additions.length === 0) {
        return existing;
    }
    const base = existing.replace(/\n*$/, '');
    return `${base}\n\n# --- added by project-baseline ---\n${additions.join('\n')}\n`;
}

/**
 * Merges AGENTS.md by the marker-block strategy: the shared block (up to and
 * including the marker) comes from the baseline; everything the repo has AFTER
 * the marker is preserved.
 *
 * @param {string} existing Current repo AGENTS.md.
 * @param {string} baseline Baseline AGENTS.md (contains the marker).
 * @param {string} marker The end-of-shared marker line.
 * @returns {{ content: string, manual: boolean }} Merged content; manual=true if
 *   the existing file has no marker (needs human placement).
 */
export function mergeMarkerBlock(existing, baseline, marker) {
    if (!existing.includes(marker)) {
        // No marker in the existing file: can't safely auto-merge. Signal manual.
        return { content: existing, manual: true };
    }
    const sharedBlock = baseline.slice(0, baseline.indexOf(marker) + marker.length);
    const preserved = existing.slice(existing.indexOf(marker) + marker.length);
    return { content: `${sharedBlock}${preserved}`, manual: false };
}

/**
 * Reads a baseline source file for a policy entry.
 *
 * @param {string} baselineRoot
 * @param {object} entry file-policy entry with a `source`.
 * @returns {string | null}
 */
function readBaselineSource(baselineRoot, entry) {
    if (!entry.source) {
        return null;
    }
    const abs = join(baselineRoot, entry.source);
    return existsSync(abs) ? readFileSync(abs, 'utf8') : null;
}

/**
 * Computes the concrete file changes for a plan, WITHOUT writing anything.
 * Only create/replace/merge actions produce changes; manual/leave are skipped.
 *
 * @param {object} args
 * @param {ReturnType<import('./plan.js').plan>} args.planned
 * @param {object} args.baseline Loaded baseline ({ root, filePolicy, ... }).
 * @param {string} args.repoRoot Target repo (read for merge inputs).
 * @param {string} args.profile Active profile (selects per-profile file sources).
 * @param {Record<string,string>} args.vars Placeholder substitutions.
 * @returns {{
 *   changes: Array<{ path: string, action: string, content: string, detail?: string }>,
 *   skippedManual: string[],
 *   demotedToManual: string[],
 *   demotedReasons: Record<string, string>
 * }}
 */
export function computeChanges({ planned, baseline, repoRoot, profile, vars }) {
    const { root: baselineRoot, filePolicy } = baseline;
    // Build the lookup from PROFILE-RESOLVED entries so each file's `source` is the
    // one that applies to this profile (e.g. node-library dependabot, not node-service).
    const policyByPath = new Map(resolvedFileEntries(filePolicy, profile).map((f) => [f.path, f]));

    const changes = [];
    const skippedManual = [];
    const demotedToManual = [];
    /** @type {Record<string, string>} Why a path was demoted to manual, where known. */
    const demotedReasons = {};

    for (const file of planned.files) {
        const { path, action } = file;
        if (action === 'leave') {
            continue;
        }
        if (action === 'manual') {
            skippedManual.push(path);
            continue;
        }

        const entry = policyByPath.get(path) ?? {};
        const source = readBaselineSource(baselineRoot, entry);

        if (action === 'create' || action === 'replace') {
            if (source === null) {
                demotedToManual.push(path);
                continue;
            }
            changes.push({ path, action, content: substitute(source, vars) });
            continue;
        }

        if (action === 'merge') {
            const existingAbs = join(repoRoot, path);
            const existing = existsSync(existingAbs) ? readFileSync(existingAbs, 'utf8') : '';
            if (source === null) {
                demotedToManual.push(path);
                continue;
            }
            const strategy = entry.merge?.strategy;
            if (strategy === 'union-lines') {
                changes.push({ path, action, content: mergeGitignore(existing, source) });
            } else if (strategy === 'marker-block') {
                const result = mergeMarkerBlock(
                    existing,
                    substitute(source, vars),
                    entry.merge.marker
                );
                if (result.manual) {
                    demotedToManual.push(path);
                } else {
                    changes.push({ path, action, content: result.content });
                }
            } else if (strategy === 'json-scripts') {
                const result = mergePackageScripts(existing, source, {
                    requires: entry.merge.requiresDevDependencies
                });
                if (result.manual) {
                    demotedToManual.push(path);
                    demotedReasons[path] = result.reason;
                } else if (result.added.length > 0) {
                    changes.push({
                        path,
                        action,
                        content: result.content,
                        detail: `added scripts: ${result.added.join(', ')}`
                    });
                }
            } else {
                // Unknown merge strategy -> safer to defer to a human.
                demotedToManual.push(path);
            }
        }
    }

    return { changes, skippedManual, demotedToManual, demotedReasons };
}
