import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * Runs git in a given cwd, returning trimmed stdout. Throws on non-zero exit.
 *
 * @param {string[]} args git arguments.
 * @param {string} cwd Working directory.
 * @returns {string}
 */
function git(args, cwd) {
    return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
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
 * Creates the adoption branch, stages everything, and commits. Does NOT push.
 * Configures a local identity so the commit works in CI/sandbox without global config.
 *
 * @param {string} workdir
 * @param {{ branch: string, message: string }} opts
 * @returns {{ branch: string, commit: string, filesChanged: number }}
 */
export function commitOnBranch(workdir, { branch, message }) {
    git(['checkout', '-b', branch], workdir);
    // Local-only identity; harmless on a throwaway clone.
    git(['config', 'user.name', 'project-baseline'], workdir);
    git(['config', 'user.email', 'project-baseline@cica.local'], workdir);
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
