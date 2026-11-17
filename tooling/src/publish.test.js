import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import {
    buildPrBody,
    buildPrTitle,
    defaultRun,
    parseGitHubRemote,
    publishAdoption,
    redactUrl,
    resolveRepoIdentity
} from './publish.js';

const BRANCH = 'baseline/adopt-1';

function git(args, cwd) {
    return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t.t', ...args], {
        cwd,
        encoding: 'utf8'
    }).trim();
}

describe('parseGitHubRemote', () => {
    const expected = { owner: 'Org', repo: 'repo' };

    it('parses https, ssh and scp-style GitHub remotes, with or without .git', () => {
        for (const url of [
            'https://github.com/Org/repo.git',
            'https://github.com/Org/repo',
            'https://github.com/Org/repo/',
            'git@github.com:Org/repo.git',
            'ssh://git@github.com/Org/repo.git',
            'https://user:token@github.com/Org/repo.git'
        ]) {
            assert.deepEqual(parseGitHubRemote(url), expected, url);
        }
    });

    it('returns null for anything that is not a GitHub remote', () => {
        for (const url of ['https://gitlab.com/o/r.git', '/var/dev/some-repo', '', undefined]) {
            assert.equal(parseGitHubRemote(url), null, String(url));
        }
    });
});

describe('resolveRepoIdentity', () => {
    const defaults = {
        folderName: 'sbx-work',
        defaultOrg: 'CriminalInjuriesCompensationAuthority'
    };

    it('takes org and repo from the GitHub origin, not the local folder or the default org', () => {
        assert.deepEqual(
            resolveRepoIdentity('https://github.com/ministryofjustice/real-repo.git', defaults),
            { org: 'ministryofjustice', repoName: 'real-repo' }
        );
    });

    it('lets an explicit --org win, while still taking the repo name from the remote', () => {
        assert.deepEqual(
            resolveRepoIdentity('git@github.com:ministryofjustice/real-repo.git', {
                ...defaults,
                explicitOrg: 'CriminalInjuriesCompensationAuthority'
            }),
            { org: 'CriminalInjuriesCompensationAuthority', repoName: 'real-repo' }
        );
    });

    it('falls back to the default org and the folder name with no usable GitHub remote', () => {
        const expected = { org: defaults.defaultOrg, repoName: 'sbx-work' };
        assert.deepEqual(resolveRepoIdentity(null, defaults), expected);
        assert.deepEqual(resolveRepoIdentity('/tmp/not-github.git', defaults), expected);
    });
});

describe('redactUrl', () => {
    it('hides credentials embedded in a URL', () => {
        assert.equal(
            redactUrl('https://user:secret@github.com/o/r.git'),
            'https://***@github.com/o/r.git'
        );
    });
    it('leaves URLs without credentials alone', () => {
        assert.equal(redactUrl('git@github.com:o/r.git'), 'git@github.com:o/r.git');
        assert.equal(redactUrl('https://github.com/o/r'), 'https://github.com/o/r');
    });
});

describe('buildPrTitle / buildPrBody', () => {
    it('titles the PR with the baseline version and profile', () => {
        assert.equal(
            buildPrTitle({ baselineVersion: '0.1.0', profile: 'node-library' }),
            'chore: adopt project-baseline 0.1.0 (node-library)'
        );
    });

    const body = buildPrBody({
        repoName: 'my-repo',
        profile: 'node-library',
        baselineVersion: '0.1.0',
        base: 'main',
        branch: BRANCH,
        changes: [
            { path: '.husky/pre-commit', action: 'create' },
            { path: 'package.json', action: 'merge', detail: 'added scripts: precommit, prepare' }
        ],
        skippedManual: ['SECURITY.md'],
        demotedToManual: ['AGENTS.md'],
        demotedReasons: { 'AGENTS.md': 'no marker found' },
        diffStat: ' 2 files changed'
    });

    it('lists what was applied, including per-file detail', () => {
        assert.match(body, /`\.husky\/pre-commit`/);
        assert.match(body, /`package\.json`.*added scripts: precommit, prepare/);
    });

    it('lists manual items with their reasons so a reviewer knows what is left to do', () => {
        assert.match(body, /`SECURITY\.md`/);
        assert.match(body, /`AGENTS\.md`.*no marker found/);
    });

    it('says nothing is merged automatically and includes the diff stat', () => {
        assert.match(body, /my-repo/);
        assert.match(body, /not merged automatically|review/i);
        assert.match(body, /2 files changed/);
    });
});

describe('publishAdoption', () => {
    let root;
    beforeEach(() => {
        root = mkdtempSync(join(tmpdir(), 'publish-'));
    });
    afterEach(() => rmSync(root, { recursive: true, force: true }));

    /**
     * Builds: a bare "GitHub" remote, a working repo (origin -> remote), and a clone of the working
     * repo carrying one adoption commit, which is exactly what `apply` produces.
     */
    function makeWorld({ remoteHasMain = true, unpushedLocalCommit = false } = {}) {
        const remote = join(root, 'remote.git');
        const work = join(root, 'work');
        const clone = join(root, 'clone');
        mkdirSync(remote);
        git(['init', '--bare', '-q', '-b', 'main'], remote);
        mkdirSync(work);
        git(['init', '-q', '-b', 'main'], work);
        writeFileSync(join(work, 'a.txt'), 'a');
        git(['add', '-A'], work);
        git(['commit', '-q', '-m', 'init'], work);
        git(['remote', 'add', 'origin', remote], work);
        if (remoteHasMain) {
            git(['push', '-q', 'origin', 'main'], work);
        }
        if (unpushedLocalCommit) {
            writeFileSync(join(work, 'secret-wip.txt'), 'not for GitHub');
            git(['add', '-A'], work);
            git(['commit', '-q', '-m', 'local only'], work);
        }
        git(['clone', '-q', '--no-hardlinks', work, clone], root);
        git(['checkout', '-q', '-b', BRANCH], clone);
        writeFileSync(join(clone, 'b.txt'), 'b');
        git(['add', '-A'], clone);
        git(['commit', '-q', '-m', 'adopt'], clone);
        return { remote, work, clone };
    }

    /** `gh` is faked; everything else (git) is real. */
    function makeRun({ existingPr = null, createFails = false } = {}) {
        const calls = [];
        const run = (file, args, opts) => {
            if (file !== 'gh') {
                return defaultRun(file, args, opts);
            }
            const call = { args };
            calls.push(call);
            if (args[0] === 'pr' && args[1] === 'list') {
                return JSON.stringify(existingPr ? [{ url: existingPr }] : []);
            }
            if (args[0] === 'pr' && args[1] === 'create') {
                call.bodyAtCall = readFileSync(args[args.indexOf('--body-file') + 1], 'utf8');
                if (createFails) {
                    throw new Error('gh: boom');
                }
                return 'https://github.com/o/r/pull/7';
            }
            throw new Error(`unexpected gh call: ${args.join(' ')}`);
        };
        return { run, calls };
    }

    const opts = (world, extra = {}) => ({
        clone: world.clone,
        branch: BRANCH,
        base: 'main',
        slug: 'o/r',
        pushUrl: world.remote,
        title: 'a title',
        body: 'a body',
        ...extra
    });
    const remoteBranches = (world) => git(['ls-remote', '--heads', world.remote], root);

    it('pushes the branch and opens a PR from a body file', () => {
        const world = makeWorld();
        const { run, calls } = makeRun();
        const result = publishAdoption(opts(world, { run }));

        assert.equal(result.status, 'created');
        assert.equal(result.url, 'https://github.com/o/r/pull/7');
        assert.match(remoteBranches(world), /refs\/heads\/baseline\/adopt-1/);

        const create = calls.find((c) => c.args[1] === 'create');
        for (const expected of ['--repo', 'o/r', '--base', 'main', '--head', BRANCH]) {
            assert.ok(create.args.includes(expected), `missing ${expected}`);
        }
        assert.equal(create.args.includes('--draft'), false);
        assert.equal(create.bodyAtCall, 'a body');
    });

    it('opens a draft PR when asked', () => {
        const world = makeWorld();
        const { run, calls } = makeRun();
        publishAdoption(opts(world, { run, draft: true }));
        assert.ok(calls.find((c) => c.args[1] === 'create').args.includes('--draft'));
    });

    it('dry run runs the checks but pushes nothing and opens nothing', () => {
        const world = makeWorld();
        const { run, calls } = makeRun();
        const result = publishAdoption(opts(world, { run, dryRun: true }));

        assert.equal(result.status, 'dry-run');
        assert.equal(remoteBranches(world).includes('baseline/adopt-1'), false);
        assert.equal(
            calls.some((c) => c.args[1] === 'create'),
            false
        );
    });

    it('refuses when the remote does not have the base branch', () => {
        const world = makeWorld({ remoteHasMain: false });
        const { run } = makeRun();
        assert.throws(() => publishAdoption(opts(world, { run })), /no branch "main"/);
        assert.equal(remoteBranches(world), '');
    });

    it('refuses when the clone carries local commits that are not on the remote', () => {
        const world = makeWorld({ unpushedLocalCommit: true });
        const { run } = makeRun();
        assert.throws(() => publishAdoption(opts(world, { run })), /not on the remote/);
        // Critically, the unpushed work must not have leaked to the remote.
        assert.equal(remoteBranches(world).includes('baseline/adopt-1'), false);
    });

    it('never overwrites an existing remote branch that has no PR', () => {
        const world = makeWorld();
        publishAdoption(opts(world, { run: makeRun().run }));
        const before = remoteBranches(world);

        const second = makeRun({ existingPr: null });
        assert.throws(() => publishAdoption(opts(world, { run: second.run })), /already exists/);
        assert.equal(remoteBranches(world), before);
        assert.equal(
            second.calls.some((c) => c.args[1] === 'create'),
            false
        );
    });

    it('reports an existing PR instead of failing or opening a duplicate', () => {
        const world = makeWorld();
        publishAdoption(opts(world, { run: makeRun().run }));

        const second = makeRun({ existingPr: 'https://github.com/o/r/pull/3' });
        const result = publishAdoption(opts(world, { run: second.run }));
        assert.equal(result.status, 'exists');
        assert.equal(result.url, 'https://github.com/o/r/pull/3');
        assert.equal(
            second.calls.some((c) => c.args[1] === 'create'),
            false
        );
    });

    it('tells the user the branch was pushed when PR creation fails afterwards', () => {
        const world = makeWorld();
        const { run } = makeRun({ createFails: true });
        assert.throws(
            () => publishAdoption(opts(world, { run })),
            (err) => {
                assert.match(err.message, /branch was pushed/i);
                assert.match(err.message, /baseline\/adopt-1/);
                return true;
            }
        );
        assert.match(remoteBranches(world), /baseline\/adopt-1/);
    });
});
