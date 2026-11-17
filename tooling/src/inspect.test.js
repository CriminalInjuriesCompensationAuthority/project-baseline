import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import {
    detectorContext,
    fileState,
    MIGRATION_DETECTORS,
    packageScriptsState,
    readPackageJson
} from './inspect.js';

/** Creates an isolated temp dir and returns helpers to populate it. */
function makeFixture() {
    const dir = mkdtempSync(join(tmpdir(), 'baseline-fixture-'));
    return {
        dir,
        file(rel, content) {
            const abs = join(dir, rel);
            mkdirSync(join(abs, '..'), { recursive: true });
            writeFileSync(abs, content);
        },
        dir_(rel) {
            mkdirSync(join(dir, rel), { recursive: true });
        },
        cleanup() {
            rmSync(dir, { recursive: true, force: true });
        }
    };
}

describe('fileState', () => {
    let fx;
    let baseline;
    beforeEach(() => {
        fx = makeFixture();
        baseline = makeFixture();
        baseline.file('common/.editorconfig', 'root = true\nindent_size = 4\n');
    });
    afterEach(() => {
        fx.cleanup();
        baseline.cleanup();
    });

    const entry = { path: '.editorconfig', source: 'common/.editorconfig' };

    it('returns absent when the repo lacks the file', () => {
        assert.equal(fileState(fx.dir, baseline.dir, entry), 'absent');
    });

    it('returns present-identical for matching content', () => {
        fx.file('.editorconfig', 'root = true\nindent_size = 4\n');
        assert.equal(fileState(fx.dir, baseline.dir, entry), 'present-identical');
    });

    it('treats EOL/trailing-whitespace-only differences as identical', () => {
        fx.file('.editorconfig', 'root = true  \r\nindent_size = 4\r\n\n');
        assert.equal(fileState(fx.dir, baseline.dir, entry), 'present-identical');
    });

    it('returns present-divergent for materially different content', () => {
        fx.file('.editorconfig', 'root = true\nindent_size = 2\n');
        assert.equal(fileState(fx.dir, baseline.dir, entry), 'present-divergent');
    });

    it('returns present-unknown when the entry has no source', () => {
        fx.file('x', 'y');
        assert.equal(fileState(fx.dir, baseline.dir, { path: 'x' }), 'present-unknown');
    });
});

describe('packageScriptsState', () => {
    let fx;
    let baseline;
    beforeEach(() => {
        fx = makeFixture();
        baseline = makeFixture();
        baseline.file(
            'common/package-scripts.json',
            JSON.stringify({ scripts: { precommit: 'a', prepush: 'b', prepare: 'husky' } })
        );
    });
    afterEach(() => {
        fx.cleanup();
        baseline.cleanup();
    });

    const entry = { path: 'package.json', source: 'common/package-scripts.json' };

    it('returns absent when the repo has no package.json', () => {
        assert.equal(packageScriptsState(fx.dir, baseline.dir, entry), 'absent');
    });

    it('returns present-divergent when any baseline script is missing', () => {
        fx.file('package.json', JSON.stringify({ scripts: { precommit: 'a' } }));
        assert.equal(packageScriptsState(fx.dir, baseline.dir, entry), 'present-divergent');
    });

    it('returns present-divergent when the repo has no scripts at all', () => {
        fx.file('package.json', '{"name":"x"}');
        assert.equal(packageScriptsState(fx.dir, baseline.dir, entry), 'present-divergent');
    });

    it('returns present-identical when every script name exists, whatever its value', () => {
        fx.file(
            'package.json',
            JSON.stringify({
                scripts: { precommit: 'custom', prepush: 'also custom', prepare: 'husky install' }
            })
        );
        assert.equal(packageScriptsState(fx.dir, baseline.dir, entry), 'present-identical');
    });

    it('returns present-unknown for an invalid package.json', () => {
        fx.file('package.json', '{ not json');
        assert.equal(packageScriptsState(fx.dir, baseline.dir, entry), 'present-unknown');
    });

    it('returns present-unknown when the baseline fragment is missing', () => {
        fx.file('package.json', '{"scripts":{}}');
        assert.equal(
            packageScriptsState(fx.dir, baseline.dir, {
                path: 'package.json',
                source: 'nope.json'
            }),
            'present-unknown'
        );
    });
});

describe('readPackageJson', () => {
    let fx;
    beforeEach(() => {
        fx = makeFixture();
    });
    afterEach(() => fx.cleanup());

    it('returns null when absent', () => {
        assert.equal(readPackageJson(fx.dir), null);
    });

    it('returns null for invalid json', () => {
        fx.file('package.json', '{ not valid');
        assert.equal(readPackageJson(fx.dir), null);
    });

    it('parses valid json', () => {
        fx.file('package.json', '{"name":"x"}');
        assert.deepEqual(readPackageJson(fx.dir), { name: 'x' });
    });
});

describe('MIGRATION_DETECTORS', () => {
    let fx;
    beforeEach(() => {
        fx = makeFixture();
    });
    afterEach(() => fx.cleanup());

    it('detects eslint-to-biome via .eslintrc.js', () => {
        fx.file('.eslintrc.js', 'module.exports = {}');
        assert.equal(MIGRATION_DETECTORS['eslint-to-biome'](detectorContext(fx.dir)), true);
    });

    it('detects jest-to-node-test via jest.config.js', () => {
        fx.file('jest.config.js', 'module.exports = {}');
        assert.equal(MIGRATION_DETECTORS['jest-to-node-test'](detectorContext(fx.dir)), true);
    });

    it('detects circleci-to-gha via .circleci dir', () => {
        fx.dir_('.circleci');
        assert.equal(MIGRATION_DETECTORS['circleci-to-gha'](detectorContext(fx.dir)), true);
    });

    it('detects commonjs-to-esm when type is not module', () => {
        fx.file('package.json', '{"name":"x"}');
        assert.equal(MIGRATION_DETECTORS['commonjs-to-esm'](detectorContext(fx.dir)), true);
    });

    it('does NOT flag commonjs-to-esm when type is module', () => {
        fx.file('package.json', '{"name":"x","type":"module"}');
        assert.equal(MIGRATION_DETECTORS['commonjs-to-esm'](detectorContext(fx.dir)), false);
    });

    it('detects husky4 via version range', () => {
        fx.file('package.json', '{"devDependencies":{"husky":"^4.0.3"}}');
        assert.equal(MIGRATION_DETECTORS['husky4-to-husky9'](detectorContext(fx.dir)), true);
    });

    it('does not flag husky when on v9', () => {
        fx.file('package.json', '{"devDependencies":{"husky":"^9.1.7"}}');
        assert.equal(MIGRATION_DETECTORS['husky4-to-husky9'](detectorContext(fx.dir)), false);
    });

    it('detects snyk via .snyk file', () => {
        fx.file('.snyk', '');
        assert.equal(
            MIGRATION_DETECTORS['snyk-to-baseline-security'](detectorContext(fx.dir)),
            true
        );
    });
});
