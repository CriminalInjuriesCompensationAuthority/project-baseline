import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { commitOnBranch, hasUncommittedChanges, remoteUrl } from './workspace.js';

function git(args, cwd) {
    return execFileSync('git', ['-c', 'user.name=seed', '-c', 'user.email=seed@s.s', ...args], {
        cwd,
        encoding: 'utf8'
    }).trim();
}

describe('workspace git helpers', () => {
    let dir;
    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'workspace-'));
        git(['init', '-q', '-b', 'main'], dir);
        writeFileSync(join(dir, 'a.txt'), 'a');
        git(['add', '-A'], dir);
        git(['commit', '-q', '-m', 'init'], dir);
        writeFileSync(join(dir, 'b.txt'), 'b');
    });
    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    const author = () => git(['log', '-1', '--format=%an <%ae>'], dir);

    it('commits with the supplied identity so pushed commits are attributable', () => {
        commitOnBranch(dir, {
            branch: 'baseline/adopt-1',
            message: 'adopt',
            identity: { name: 'Ada Lovelace', email: 'ada@example.org' }
        });
        assert.equal(author(), 'Ada Lovelace <ada@example.org>');
    });

    it('falls back to a local project-baseline identity when none is supplied', () => {
        commitOnBranch(dir, { branch: 'baseline/adopt-1', message: 'adopt' });
        assert.equal(author(), 'project-baseline <project-baseline@cica.local>');
    });

    it('reports zero changed files and makes no commit when there is nothing to commit', () => {
        git(['add', '-A'], dir);
        git(['commit', '-q', '-m', 'b'], dir);
        const before = git(['rev-parse', 'HEAD'], dir);
        const result = commitOnBranch(dir, { branch: 'baseline/adopt-1', message: 'adopt' });
        assert.equal(result.filesChanged, 0);
        assert.equal(result.commit, before);
    });
});

describe('hasUncommittedChanges', () => {
    let dir;
    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'dirty-'));
        git(['init', '-q', '-b', 'main'], dir);
        writeFileSync(join(dir, 'a.txt'), 'a');
        git(['add', '-A'], dir);
        git(['commit', '-q', '-m', 'init'], dir);
    });
    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    it('is false for a clean tree', () => {
        assert.equal(hasUncommittedChanges(dir), false);
    });

    it('is true when a tracked file is modified (it would leak into a merged file)', () => {
        writeFileSync(join(dir, 'a.txt'), 'changed');
        assert.equal(hasUncommittedChanges(dir), true);
    });

    it('is true for staged-but-uncommitted changes', () => {
        writeFileSync(join(dir, 'a.txt'), 'changed');
        git(['add', '-A'], dir);
        assert.equal(hasUncommittedChanges(dir), true);
    });

    it('ignores untracked files, which never feed a merge', () => {
        writeFileSync(join(dir, 'new.txt'), 'untracked');
        assert.equal(hasUncommittedChanges(dir), false);
    });
});

describe('remoteUrl', () => {
    let dir;
    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'remote-'));
        git(['init', '-q', '-b', 'main'], dir);
    });
    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    it('returns null when the repo has no such remote', () => {
        assert.equal(remoteUrl(dir), null);
    });

    it('returns the configured URL', () => {
        git(['remote', 'add', 'origin', 'https://github.com/o/r.git'], dir);
        assert.equal(remoteUrl(dir), 'https://github.com/o/r.git');
    });
});
