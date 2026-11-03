import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import {
    extractReferences,
    hygieneForRepo,
    isValidPackageName,
    packageNameFromSpecifier,
    versionSkew
} from './deps.js';

describe('packageNameFromSpecifier', () => {
    it('handles plain packages', () => {
        assert.equal(packageNameFromSpecifier('express'), 'express');
        assert.equal(packageNameFromSpecifier('express/lib/router'), 'express');
    });
    it('handles scoped packages', () => {
        assert.equal(packageNameFromSpecifier('@cica/logger'), '@cica/logger');
        assert.equal(packageNameFromSpecifier('@cica/logger/sub'), '@cica/logger');
    });
});

describe('isValidPackageName', () => {
    it('accepts valid names', () => {
        assert.equal(isValidPackageName('govuk-frontend'), true);
        assert.equal(isValidPackageName('@ministryofjustice/frontend'), true);
    });
    it('rejects template-literal and junk captures', () => {
        // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional junk input under test
        const templatePlaceholder = '${trackedPackage}';
        assert.equal(isValidPackageName(templatePlaceholder), false);
        assert.equal(isValidPackageName('`x`'), false);
        assert.equal(isValidPackageName('a b'), false);
    });
});

describe('extractReferences', () => {
    it('extracts import/require/import() specifiers, ignoring builtins/relatives', () => {
        const text = `
            import express from 'express';
            const fs = require('node:fs');
            const local = require('./local');
            import('@cica/logger');
            import x from '@scope/pkg/sub';
        `;
        const { packages } = extractReferences(text);
        assert.ok(packages.has('express'));
        assert.ok(packages.has('@cica/logger'));
        assert.ok(packages.has('@scope/pkg'));
        assert.equal(packages.has('node:fs'), false);
        assert.equal(
            [...packages].some((p) => p.startsWith('.')),
            false
        );
    });

    it('extracts node_modules literal paths and rejects junk', () => {
        // Build the junk reference without a real template literal so the linter
        // doesn't flag the intentional ${...} placeholder.
        const dollar = '$';
        const junkLine = `const bad = \`node_modules/${dollar}{trackedPackage}\`;`;
        const text = [
            "express.static('node_modules/govuk-frontend/dist/govuk/assets');",
            junkLine,
            "require('node_modules/@scope/pkg/x');"
        ].join('\n');
        const { nodeModulesPaths } = extractReferences(text);
        assert.ok(nodeModulesPaths.includes('govuk-frontend'));
        assert.ok(nodeModulesPaths.includes('@scope/pkg'));
        assert.equal(
            nodeModulesPaths.some((p) => p.includes('$')),
            false
        );
    });
});

describe('hygieneForRepo', () => {
    let dir;
    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'deps-'));
    });
    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    function write(rel, content) {
        const abs = join(dir, rel);
        mkdirSync(join(abs, '..'), { recursive: true });
        writeFileSync(abs, content);
    }

    it('returns null without package.json', () => {
        assert.equal(hygieneForRepo(dir), null);
    });

    it('flags undeclared-referenced (not builtins), unused, and transitive reaches', () => {
        write(
            'package.json',
            JSON.stringify({
                dependencies: { express: '^5.0.0', 'unused-dep': '^1.0.0' }
            })
        );
        write(
            'app.js',
            `import express from 'express';
             import missing from 'missing-pkg';
             const fs = require('node:fs');
             express.static('node_modules/govuk-frontend/dist');`
        );

        const h = hygieneForRepo(dir);
        assert.ok(h.undeclaredReferenced.includes('missing-pkg'));
        assert.equal(h.undeclaredReferenced.includes('node:fs'), false);
        assert.equal(h.undeclaredReferenced.includes('express'), false);
        assert.ok(h.declaredUnused.includes('unused-dep'));
        assert.ok(h.transitivePathReaches.includes('govuk-frontend'));
    });

    it('ignores test files when scanning references', () => {
        write('package.json', JSON.stringify({ dependencies: {} }));
        write('thing.test.js', `import fixture from 'fake-fixture-pkg';`);
        const h = hygieneForRepo(dir);
        assert.equal(h.undeclaredReferenced.includes('fake-fixture-pkg'), false);
    });
});

describe('versionSkew', () => {
    it('reports only deps with more than one distinct version', () => {
        const repoDeps = [
            { name: 'a', declared: { express: '^5.0.0', lodash: '^4.0.0' } },
            { name: 'b', declared: { express: '^4.0.0', lodash: '^4.0.0' } }
        ];
        const skew = versionSkew(repoDeps);
        assert.equal(skew.length, 1);
        assert.equal(skew[0].dependency, 'express');
        assert.deepEqual(Object.keys(skew[0].versions).sort(), ['^4.0.0', '^5.0.0']);
    });
});
