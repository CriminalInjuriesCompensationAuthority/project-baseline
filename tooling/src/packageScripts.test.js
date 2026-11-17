import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    detectJsonIndent,
    mergePackageScripts,
    missingScripts,
    unmetRequirements
} from './packageScripts.js';

describe('missingScripts', () => {
    it('returns fragment script names absent from the package', () => {
        const pkg = { scripts: { test: 'x', precommit: 'y' } };
        const fragment = { scripts: { precommit: 'y', prepush: 'z', prepare: 'husky' } };
        assert.deepEqual(missingScripts(pkg, fragment), ['prepush', 'prepare']);
    });

    it('treats a package with no scripts as missing everything', () => {
        assert.deepEqual(missingScripts({}, { scripts: { a: '1', b: '2' } }), ['a', 'b']);
    });

    it('returns nothing when the fragment has no scripts', () => {
        assert.deepEqual(missingScripts({ scripts: { a: '1' } }, {}), []);
    });

    it('matches on name only, never value (values are repo-specific)', () => {
        const pkg = { scripts: { prepush: 'npm test && npm run custom' } };
        assert.deepEqual(missingScripts(pkg, { scripts: { prepush: 'something else' } }), []);
    });
});

describe('unmetRequirements', () => {
    const requires = { husky: 9, '@biomejs/biome': 2 };

    it('returns nothing when there are no requirements', () => {
        assert.deepEqual(unmetRequirements({}, undefined), []);
        assert.deepEqual(unmetRequirements({}, {}), []);
    });

    it('flags a required dependency that is not installed', () => {
        const unmet = unmetRequirements({ devDependencies: { husky: '^9.1.7' } }, requires);
        assert.equal(unmet.length, 1);
        assert.match(unmet[0], /@biomejs\/biome/);
        assert.match(unmet[0], /not a dependency/);
    });

    it('flags a dependency below the required major (husky 4)', () => {
        const pkg = { devDependencies: { husky: '^4.0.3', '@biomejs/biome': '2.5.12' } };
        const unmet = unmetRequirements(pkg, requires);
        assert.equal(unmet.length, 1);
        assert.match(unmet[0], /husky/);
        assert.match(unmet[0], /\^4\.0\.3/);
    });

    it('accepts the common range styles at or above the required major', () => {
        for (const range of ['^9.1.7', '9.1.7', '~9.0.0', '>=9', '10.0.0']) {
            const pkg = { devDependencies: { husky: range, '@biomejs/biome': '2.5.12' } };
            assert.deepEqual(unmetRequirements(pkg, requires), [], range);
        }
    });

    it('also accepts a requirement satisfied via dependencies', () => {
        const pkg = { dependencies: { husky: '^9.0.0', '@biomejs/biome': '^2.0.0' } };
        assert.deepEqual(unmetRequirements(pkg, requires), []);
    });

    it('treats an unparseable range as unmet (safe default)', () => {
        const pkg = { devDependencies: { husky: 'latest', '@biomejs/biome': '2.5.12' } };
        assert.equal(unmetRequirements(pkg, requires).length, 1);
    });
});

describe('detectJsonIndent', () => {
    it('detects 4-space indentation', () => {
        assert.equal(detectJsonIndent('{\n    "a": 1\n}\n'), 4);
    });
    it('detects 2-space indentation', () => {
        assert.equal(detectJsonIndent('{\n  "a": 1\n}\n'), 2);
    });
    it('detects tab indentation', () => {
        assert.equal(detectJsonIndent('{\n\t"a": 1\n}\n'), '\t');
    });
    it('defaults to 2 (the npm default) when indentation cannot be determined', () => {
        assert.equal(detectJsonIndent('{"a":1}'), 2);
    });
});

describe('mergePackageScripts', () => {
    const fragment = JSON.stringify({
        scripts: { precommit: 'npm run precommit:staged', prepare: 'husky' }
    });

    it('adds missing scripts and reports them', () => {
        const existing = '{\n    "name": "x",\n    "scripts": {\n        "test": "t"\n    }\n}\n';
        const { content, added, manual } = mergePackageScripts(existing, fragment);
        assert.equal(manual, false);
        assert.deepEqual(added, ['precommit', 'prepare']);
        const parsed = JSON.parse(content);
        assert.equal(parsed.scripts.precommit, 'npm run precommit:staged');
        assert.equal(parsed.scripts.prepare, 'husky');
    });

    it('never overwrites an existing script, even when its value differs', () => {
        const existing = '{\n    "scripts": {\n        "prepare": "husky install"\n    }\n}\n';
        const { content, added } = mergePackageScripts(existing, fragment);
        assert.deepEqual(added, ['precommit']);
        assert.equal(JSON.parse(content).scripts.prepare, 'husky install');
    });

    it('keeps existing scripts first and appends additions after them', () => {
        const existing =
            '{\n    "scripts": {\n        "test": "t",\n        "lint": "l"\n    }\n}\n';
        const { content } = mergePackageScripts(existing, fragment);
        assert.deepEqual(Object.keys(JSON.parse(content).scripts), [
            'test',
            'lint',
            'precommit',
            'prepare'
        ]);
    });

    it('creates the scripts object when the package has none', () => {
        const { content, added } = mergePackageScripts('{\n  "name": "x"\n}\n', fragment);
        assert.deepEqual(added, ['precommit', 'prepare']);
        assert.equal(JSON.parse(content).name, 'x');
        assert.equal(JSON.parse(content).scripts.prepare, 'husky');
    });

    it('preserves unrelated keys and nested values untouched', () => {
        const existing =
            '{\n  "name": "x",\n  "engines": { "node": ">=24" },\n  "files": ["a", "b"]\n}\n';
        const parsed = JSON.parse(mergePackageScripts(existing, fragment).content);
        assert.deepEqual(parsed.engines, { node: '>=24' });
        assert.deepEqual(parsed.files, ['a', 'b']);
    });

    it('preserves the existing indent style', () => {
        const four = mergePackageScripts('{\n    "name": "x"\n}\n', fragment).content;
        assert.ok(four.includes('\n    "name"'));
        const tab = mergePackageScripts('{\n\t"name": "x"\n}\n', fragment).content;
        assert.ok(tab.includes('\n\t"name"'));
    });

    it('preserves the presence or absence of a trailing newline', () => {
        const withNl = mergePackageScripts('{\n  "name": "x"\n}\n', fragment).content;
        assert.ok(withNl.endsWith('}\n'));
        const withoutNl = mergePackageScripts('{\n  "name": "x"\n}', fragment).content;
        assert.ok(withoutNl.endsWith('}'));
        assert.equal(withoutNl.endsWith('\n'), false);
    });

    it('is a no-op (same content, nothing added) when every script already exists', () => {
        const existing = '{\n  "scripts": {\n    "precommit": "a",\n    "prepare": "b"\n  }\n}\n';
        const result = mergePackageScripts(existing, fragment);
        assert.equal(result.content, existing);
        assert.deepEqual(result.added, []);
        assert.equal(result.manual, false);
    });

    it('signals manual for invalid existing JSON', () => {
        const result = mergePackageScripts('{ not json', fragment);
        assert.equal(result.manual, true);
        assert.equal(result.content, '{ not json');
    });

    it('signals manual when existing scripts is not an object', () => {
        assert.equal(mergePackageScripts('{"scripts":"oops"}', fragment).manual, true);
        assert.equal(mergePackageScripts('{"scripts":["a"]}', fragment).manual, true);
    });

    it('signals manual for an invalid baseline fragment', () => {
        assert.equal(mergePackageScripts('{"name":"x"}', '{ nope').manual, true);
    });

    describe('with prerequisites', () => {
        const requires = { husky: 9 };

        it('demotes to manual, with a reason, when scripts are missing and a prerequisite is unmet', () => {
            const existing = '{"devDependencies":{"husky":"^4.0.3"}}';
            const result = mergePackageScripts(existing, fragment, { requires });
            assert.equal(result.manual, true);
            assert.equal(result.content, existing);
            assert.deepEqual(result.added, []);
            assert.match(result.reason, /prerequisites/i);
            assert.match(result.reason, /husky/);
        });

        it('merges normally when prerequisites are met', () => {
            const existing = '{"devDependencies":{"husky":"^9.1.7"}}';
            const result = mergePackageScripts(existing, fragment, { requires });
            assert.equal(result.manual, false);
            assert.deepEqual(result.added, ['precommit', 'prepare']);
        });

        it('does not demand prerequisites when there is nothing to add', () => {
            const existing =
                '{"scripts":{"precommit":"a","prepare":"b"},"devDependencies":{"husky":"^4.0.3"}}';
            const result = mergePackageScripts(existing, fragment, { requires });
            assert.equal(result.manual, false);
            assert.deepEqual(result.added, []);
        });
    });
});
