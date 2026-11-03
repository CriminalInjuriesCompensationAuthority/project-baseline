import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Scope classification for a candidate directory.
 * @typedef {'node' | 'python' | 'multi-tool' | 'not-a-repo' | 'not-node'} ScopeKind
 */

/**
 * Classifies a directory against the project-baseline scope rules.
 * Node repos are in scope; Python, multi-tool (no root package.json but tool
 * subdirs), and non-repos are out of scope (recorded decisions, see
 * baseline.config.yaml `scope`).
 *
 * @param {string} dir Absolute directory path.
 * @returns {{ kind: ScopeKind, inScope: boolean, reason: string }}
 */
export function classifyRepo(dir) {
    if (!existsSync(dir) || !statSync(dir).isDirectory()) {
        return { kind: 'not-a-repo', inScope: false, reason: 'not a directory' };
    }
    const isGit = existsSync(join(dir, '.git'));
    const hasPackageJson = existsSync(join(dir, 'package.json'));

    // Python markers -> explicitly out of scope.
    const pythonMarkers = ['pyproject.toml', 'requirements.txt', 'pytest.ini', 'uv.lock'];
    if (pythonMarkers.some((m) => existsSync(join(dir, m)))) {
        return { kind: 'python', inScope: false, reason: 'python repo (out of scope)' };
    }

    if (!hasPackageJson) {
        if (!isGit) {
            return { kind: 'not-a-repo', inScope: false, reason: 'no .git and no package.json' };
        }
        return {
            kind: 'multi-tool',
            inScope: false,
            reason: 'git repo without root package.json (multi-tool / non-standard, out of scope)'
        };
    }

    return { kind: 'node', inScope: true, reason: 'node repo' };
}

/**
 * Reads a repo's declared profile from .project-baseline.yaml if present.
 * Light parse (avoids a YAML dep for a two-field file).
 *
 * @param {string} dir Absolute repo path.
 * @returns {string | null} Profile name, or null if unmanaged/absent.
 */
export function declaredProfile(dir) {
    const metaPath = join(dir, '.project-baseline.yaml');
    if (!existsSync(metaPath)) {
        return null;
    }
    const match = readFileSync(metaPath, 'utf8').match(/^\s*profile:\s*(\S+)\s*$/m);
    return match ? match[1] : null;
}

/**
 * Heuristically guesses a profile for an unmanaged repo, so audit can run before
 * adoption assigns one. Libraries have no Dockerfile; actions have action.yml.
 *
 * @param {string} dir Absolute repo path.
 * @returns {string} Best-guess profile name.
 */
export function guessProfile(dir) {
    if (existsSync(join(dir, 'action.yml')) || existsSync(join(dir, 'action.yaml'))) {
        return 'github-action';
    }
    if (existsSync(join(dir, 'Dockerfile'))) {
        return 'node-service';
    }
    return 'node-library';
}

/**
 * Enumerates candidate repos directly under a parent directory and classifies each.
 *
 * @param {string} parentDir Absolute parent directory (e.g. /var/dev).
 * @param {object} [opts]
 * @param {string[]} [opts.exclude=[]] Directory names to skip (e.g. the baseline repo itself).
 * @returns {Array<{ name: string, dir: string, scope: ReturnType<typeof classifyRepo>, profile: string|null }>}
 */
export function enumerateEstate(parentDir, opts = {}) {
    const exclude = new Set(opts.exclude ?? []);
    return readdirSync(parentDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !exclude.has(entry.name))
        .map((entry) => {
            const dir = join(parentDir, entry.name);
            const scope = classifyRepo(dir);
            const profile = scope.inScope ? (declaredProfile(dir) ?? guessProfile(dir)) : null;
            return { name: entry.name, dir, scope, profile };
        });
}
