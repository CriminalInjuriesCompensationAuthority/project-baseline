import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * Runs git in a given cwd, returning trimmed stdout. Throws on non-zero exit. stderr is captured
 * (it appears in the thrown error's message) rather than leaking to the terminal, so callers that
 * expect and handle a failure, such as a missing remote, stay quiet.
 *
 * @param {string[]} args git arguments.
 * @param {string} cwd Working directory.
 * @returns {string}
 */
function git(args, cwd) {
    return execFileSync('git', args, {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
    }).trim();
}

/**
 * Clones a local repo into a fresh temp directory. Uses a local clone so nothing
 * touches the network or the original working tree.
 *
 * @param {string} sourceRepo Absolute path to the source repo (must be a git repo).
 * @param {string} name Short name used in the temp dir prefix.
 * @returns {string} Absolute path to the clone.
 */
export function cloneToTemp(sourceRepo, name) {
    const parent = mkdtempSync(join(tmpdir(), `baseline-apply-${name}-`));
    const dest = join(parent, name);
    // --local uses hardlinks where possible; --no-hardlinks keeps the clone fully
    // independent so edits can never affect the source object store.
    git(['clone', '--no-hardlinks', '--quiet', sourceRepo, dest], parent);
    return dest;
}

/**
 * Writes a set of computed changes into a working directory.
 *
 * @param {string} workdir Absolute working directory (a clone).
 * @param {Array<{ path: string, content: string }>} changes
 */
export function writeChanges(workdir, changes) {
    for (const change of changes) {
        const abs = join(workdir, change.path);
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, change.content);
    }
}

/**
 * Writes the .project-baseline.yaml metadata file.
 *
 * @param {string} workdir
 * @param {{ baselineVersion: string, profile: string, org: string, adoptedAt: string }} meta
 */
export function writeMetadata(workdir, meta) {
    const content = [
        '# Managed by project-baseline. See docs/metadata.md.',
        `baselineVersion: ${meta.baselineVersion}`,
        `profile: ${meta.profile}`,
        `org: ${meta.org}`,
        `adoptedAt: ${meta.adoptedAt}`,
        'managed: true',
        ''
    ].join('\n');
    writeFileSync(join(workdir, '.project-baseline.yaml'), content);
}

/**
 * Reads the configured git identity for a repo (local config, falling back to global).
 *
 * @param {string} workdir
 * @returns {{ name: string, email: string } | undefined} Undefined unless BOTH are configured.
 */
export function gitIdentity(workdir) {
    try {
        const name = git(['config', 'user.name'], workdir);
        const email = git(['config', 'user.email'], workdir);
        return name && email ? { name, email } : undefined;
    } catch {
        return undefined;
    }
}

/**
 * Whether tracked files have uncommitted (staged or unstaged) changes. Untracked files are ignored:
 * they never feed a merge. `apply` reads merge inputs from the working tree but commits onto a clone
 * of the COMMITTED state, so uncommitted edits would otherwise be folded into merged files.
 *
 * @param {string} workdir
 * @returns {boolean}
 */
export function hasUncommittedChanges(workdir) {
    return git(['status', '--porcelain', '--untracked-files=no'], workdir) !== '';
}

/**
 * Returns the URL of a git remote, or null if the repo has no such remote.
 *
 * @param {string} workdir
 * @param {string} [name='origin']
 * @returns {string | null}
 */
export function remoteUrl(workdir, name = 'origin') {
    try {
        return git(['remote', 'get-url', name], workdir) || null;
    } catch {
        return null;
    }
}

/**
 * Creates the adoption branch, stages everything, and commits. Does NOT push.
 * Sets a clone-local identity so the commit works without global git config: the supplied identity
 * (so commits that get pushed are attributable to a real person), else a placeholder.
 *
 * @param {string} workdir
 * @param {{ branch: string, message: string, identity?: { name: string, email: string } }} opts
 * @returns {{ branch: string, commit: string, filesChanged: number }}
 */
export function commitOnBranch(workdir, { branch, message, identity }) {
    git(['checkout', '-b', branch], workdir);
    git(['config', 'user.name', identity?.name || 'project-baseline'], workdir);
    git(['config', 'user.email', identity?.email || 'project-baseline@cica.local'], workdir);
    git(['add', '-A'], workdir);

    const status = git(['status', '--porcelain'], workdir);
    if (!status) {
        return { branch, commit: git(['rev-parse', 'HEAD'], workdir), filesChanged: 0 };
    }

    const filesChanged = status.split('\n').filter(Boolean).length;
    git(['commit', '--quiet', '-m', message], workdir);
    return { branch, commit: git(['rev-parse', 'HEAD'], workdir), filesChanged };
}

/**
 * Returns the diff stat of the adoption branch against its base, for reporting.
 *
 * @param {string} workdir
 * @param {string} baseBranch Base branch name (e.g. the default branch).
 * @returns {string}
 */
export function diffStat(workdir, baseBranch) {
    return git(['diff', '--stat', `${baseBranch}..HEAD`], workdir);
}

/**
 * Detects the default branch name of a clone (origin/HEAD target).
 *
 * @param {string} workdir
 * @returns {string} e.g. 'main' or 'master'
 */
export function defaultBranch(workdir) {
    try {
        const ref = git(['symbolic-ref', 'refs/remotes/origin/HEAD'], workdir);
        return ref.replace('refs/remotes/origin/', '');
    } catch {
        return git(['rev-parse', '--abbrev-ref', 'HEAD'], workdir);
    }
}
