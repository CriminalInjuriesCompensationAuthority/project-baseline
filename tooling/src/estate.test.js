import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { classifyRepo, declaredProfile, enumerateEstate, guessProfile } from './estate.js';

function makeDir() {
    const dir = mkdtempSync(join(tmpdir(), 'estate-'));
    return {
        dir,
        file(rel, content = '') {
            const abs = join(dir, rel);
            mkdirSync(join(abs, '..'), { recursive: true });
            writeFileSync(abs, content);
        },
        sub(rel) {
            mkdirSync(join(dir, rel), { recursive: true });
            return join(dir, rel);
        },
        cleanup() {
            rmSync(dir, { recursive: true, force: true });
        }
    };
}

describe('classifyRepo', () => {
    let fx;
    beforeEach(() => {
        fx = makeDir();
    });
    afterEach(() => fx.cleanup());

    it('classifies a node repo (package.json) as in scope', () => {
        fx.file('package.json', '{}');
        const c = classifyRepo(fx.dir);
        assert.equal(c.kind, 'node');
        assert.equal(c.inScope, true);
    });

    it('classifies a python repo as out of scope', () => {
        fx.file('pyproject.toml', '');
        fx.file('package.json', '{}'); // even with a package.json, python markers win
        const c = classifyRepo(fx.dir);
        assert.equal(c.kind, 'python');
        assert.equal(c.inScope, false);
    });

    it('classifies a git repo without package.json as multi-tool (out of scope)', () => {
        fx.sub('.git');
        const c = classifyRepo(fx.dir);
        assert.equal(c.kind, 'multi-tool');
        assert.equal(c.inScope, false);
    });

    it('classifies a bare dir as not-a-repo', () => {
        const c = classifyRepo(fx.dir);
        assert.equal(c.kind, 'not-a-repo');
        assert.equal(c.inScope, false);
    });
});

describe('guessProfile', () => {
    let fx;
    beforeEach(() => {
        fx = makeDir();
    });
    afterEach(() => fx.cleanup());

    it('guesses github-action when action.yml present', () => {
        fx.file('action.yml', '');
        assert.equal(guessProfile(fx.dir), 'github-action');
    });

    it('guesses node-service when Dockerfile present', () => {
        fx.file('Dockerfile', '');
        assert.equal(guessProfile(fx.dir), 'node-service');
    });

    it('defaults to node-library otherwise', () => {
        assert.equal(guessProfile(fx.dir), 'node-library');
    });
});

describe('declaredProfile', () => {
    let fx;
    beforeEach(() => {
        fx = makeDir();
    });
    afterEach(() => fx.cleanup());

    it('returns null when no metadata file', () => {
        assert.equal(declaredProfile(fx.dir), null);
    });

    it('reads the profile from .project-baseline.yaml', () => {
        fx.file('.project-baseline.yaml', 'profile: node-service\nmanaged: true\n');
        assert.equal(declaredProfile(fx.dir), 'node-service');
    });
});

describe('enumerateEstate', () => {
    let fx;
    beforeEach(() => {
        fx = makeDir();
    });
    afterEach(() => fx.cleanup());

    it('enumerates and classifies subdirectories, honouring exclude', () => {
        fx.file('svc/package.json', '{}');
        fx.file('svc/Dockerfile', '');
        fx.file('lib/package.json', '{}');
        fx.file('py/pyproject.toml', '');
        fx.sub('skipme');

        const rows = enumerateEstate(fx.dir, { exclude: ['skipme'] });
        const byName = Object.fromEntries(rows.map((r) => [r.name, r]));

        assert.equal(byName.skipme, undefined);
        assert.equal(byName.svc.scope.inScope, true);
        assert.equal(byName.svc.profile, 'node-service');
        assert.equal(byName.lib.profile, 'node-library');
        assert.equal(byName.py.scope.inScope, false);
    });
});
