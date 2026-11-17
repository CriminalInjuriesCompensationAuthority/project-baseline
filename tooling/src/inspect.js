import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { resolvedFileEntries } from './config.js';
import { missingScripts } from './packageScripts.js';

/**
 * File presence/divergence states.
 * @typedef {'absent' | 'present-identical' | 'present-divergent' | 'present-unknown'} FileState
 */

/**
 * Reads a repo file as text, or returns null if absent.
 *
 * @param {string} repoRoot Absolute repo path.
 * @param {string} relPath Repo-relative file path.
 * @returns {string | null}
 */
function readRepoFile(repoRoot, relPath) {
    const abs = join(repoRoot, relPath);
    if (!existsSync(abs) || !statSync(abs).isFile()) {
        return null;
    }
    return readFileSync(abs, 'utf8');
}

/**
 * Normalises text for comparison: trailing whitespace per line and final newline
 * are ignored, so a file that differs only in EOL/whitespace is "identical".
 *
 * @param {string} text
 * @returns {string}
 */
function normalise(text) {
    return text
        .replace(/\r\n/g, '\n')
        .split('\n')
        .map((line) => line.replace(/\s+$/, ''))
        .join('\n')
        .replace(/\n+$/, '');
}

/**
 * Determines the presence/divergence state of a single baselined file.
 *
 * @param {string} repoRoot Absolute repo path.
 * @param {string} baselineRoot Absolute project-baseline path.
 * @param {object} entry file-policy entry ({ path, source }).
 * @returns {FileState}
 */
export function fileState(repoRoot, baselineRoot, entry) {
    const repoContent = readRepoFile(repoRoot, entry.path);
    if (repoContent === null) {
        return 'absent';
    }
    if (!entry.source) {
        return 'present-unknown';
    }
    const baselineContent = readRepoFile(baselineRoot, entry.source);
    if (baselineContent === null) {
        return 'present-unknown';
    }
    return normalise(repoContent) === normalise(baselineContent)
        ? 'present-identical'
        : 'present-divergent';
}

/**
 * Determines the state of a file managed by the `json-scripts` merge strategy (package.json).
 *
 * Whole-file comparison is meaningless for package.json (it is unique per repo), so state is based
 * on whether every script NAME in the baseline fragment exists in the repo's `scripts`. Values are
 * deliberately not compared: they are legitimately repo-specific.
 *
 * @param {string} repoRoot Absolute repo path.
 * @param {string} baselineRoot Absolute project-baseline path.
 * @param {object} entry file-policy entry ({ path, source }).
 * @returns {FileState} absent (no package.json); present-identical (all script names exist);
 *   present-divergent (some missing); present-unknown (unparseable JSON or no fragment).
 */
export function packageScriptsState(repoRoot, baselineRoot, entry) {
    const repoRaw = readRepoFile(repoRoot, entry.path);
    if (repoRaw === null) {
        return 'absent';
    }
    const fragmentRaw = entry.source ? readRepoFile(baselineRoot, entry.source) : null;
    if (fragmentRaw === null) {
        return 'present-unknown';
    }
    try {
        const missing = missingScripts(JSON.parse(repoRaw), JSON.parse(fragmentRaw));
        return missing.length === 0 ? 'present-identical' : 'present-divergent';
    } catch {
        return 'present-unknown';
    }
}

/**
 * Loads a repo's package.json, or null if absent/invalid.
 *
 * @param {string} repoRoot
 * @returns {object | null}
 */
export function readPackageJson(repoRoot) {
    const raw = readRepoFile(repoRoot, 'package.json');
    if (raw === null) {
        return null;
    }
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

/**
 * Built-in migration detectors. Each returns true if the repo exhibits the
 * "from" state that the migration moves away from. Kept here (not in YAML) because
 * detection is logic, not data; the YAML `migrations` block documents intent.
 */
export const MIGRATION_DETECTORS = {
    'eslint-to-biome': (ctx) =>
        ctx.hasFile('.eslintrc.js') ||
        ctx.hasDevDep('eslint-config-airbnb-base') ||
        ctx.hasDevDep('eslint'),
    'jest-to-node-test': (ctx) =>
        ctx.hasFile('jest.config.js') || ctx.hasDevDep('jest') || ctx.script('test') === 'jest',
    'commonjs-to-esm': (ctx) => ctx.pkg !== null && ctx.pkg.type !== 'module',
    'circleci-to-gha': (ctx) => ctx.hasDir('.circleci'),
    'husky4-to-husky9': (ctx) => ctx.hasFile('.huskyrc.js') || ctx.hasDevDepRange('husky', '^4'),
    'snyk-to-baseline-security': (ctx) => ctx.hasFile('.snyk')
};

/**
 * Builds the detector context for a repo.
 *
 * @param {string} repoRoot
 * @returns {object} Context with helper predicates used by MIGRATION_DETECTORS.
 */
export function detectorContext(repoRoot) {
    const pkg = readPackageJson(repoRoot);
    const devDeps = pkg?.devDependencies ?? {};
    return {
        pkg,
        hasFile: (rel) => readRepoFile(repoRoot, rel) !== null,
        hasDir: (rel) => {
            const abs = join(repoRoot, rel);
            return existsSync(abs) && statSync(abs).isDirectory();
        },
        hasDevDep: (name) => Object.hasOwn(devDeps, name),
        hasDevDepRange: (name, prefix) =>
            Object.hasOwn(devDeps, name) && String(devDeps[name]).includes(prefix),
        script: (name) => pkg?.scripts?.[name]
    };
}

/**
 * Inspects a repo against the baseline for a given profile.
 * Read-only: never writes to the repo.
 *
 * @param {object} args
 * @param {string} args.repoRoot Absolute repo path.
 * @param {string} args.profile Profile name.
 * @param {import('./config.js').loadBaseline extends (...a:any)=>infer R ? R : never} args.baseline
 *   Loaded baseline ({ root, config, filePolicy, versions }).
 * @returns {{
 *   repoRoot: string,
 *   profile: string,
 *   files: Array<{ path: string, state: FileState, policy: object }>,
 *   migrations: Array<{ id: string, applies: boolean }>
 * }}
 */
export function inspect({ repoRoot, profile, baseline }) {
    const { root: baselineRoot, filePolicy } = baseline;

    // Only entries that apply to this profile, with `source` resolved per profile.
    const entries = resolvedFileEntries(filePolicy, profile);
    const files = entries.map((entry) => ({
        path: entry.path,
        // json-scripts entries (package.json) are judged by script presence, not whole-file equality.
        state:
            entry.merge?.strategy === 'json-scripts'
                ? packageScriptsState(repoRoot, baselineRoot, entry)
                : fileState(repoRoot, baselineRoot, entry),
        policy: entry
    }));

    const ctx = detectorContext(repoRoot);
    const migrations = (filePolicy.migrations ?? []).map((m) => {
        const detector = MIGRATION_DETECTORS[m.id];
        return {
            id: m.id,
            applies: detector ? Boolean(detector(ctx)) : false,
            meta: m
        };
    });

    return { repoRoot, profile, files, migrations };
}
