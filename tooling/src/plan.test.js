import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { plan, renderMarkdown, resolveAction } from './plan.js';

describe('resolveAction', () => {
    it('uses whenAbsent when the file is absent', () => {
        assert.equal(
            resolveAction({ state: 'absent', policy: { whenAbsent: 'create' } }),
            'create'
        );
    });

    it('defaults absent to create when whenAbsent is unset', () => {
        assert.equal(resolveAction({ state: 'absent', policy: {} }), 'create');
    });

    it('always leaves an identical file regardless of policy', () => {
        assert.equal(
            resolveAction({ state: 'present-identical', policy: { whenPresent: 'replace' } }),
            'leave'
        );
    });

    it('uses whenPresent for a divergent file', () => {
        assert.equal(
            resolveAction({ state: 'present-divergent', policy: { whenPresent: 'manual' } }),
            'manual'
        );
    });

    it('respects whenPresent: leave for a divergent create-only scaffold', () => {
        assert.equal(
            resolveAction({ state: 'present-divergent', policy: { whenPresent: 'leave' } }),
            'leave'
        );
    });

    it('defaults divergent to manual when whenPresent is unset', () => {
        assert.equal(resolveAction({ state: 'present-divergent', policy: {} }), 'manual');
    });
});

describe('plan', () => {
    const inspection = {
        repoRoot: '/tmp/repo',
        profile: 'node-service',
        files: [
            { path: 'a', state: 'absent', policy: { whenAbsent: 'create' } },
            { path: 'b', state: 'present-divergent', policy: { whenPresent: 'replace' } },
            { path: 'c', state: 'present-divergent', policy: { whenPresent: 'manual' } },
            { path: 'd', state: 'present-identical', policy: {} },
            { path: 'e', state: 'present-divergent', policy: { whenPresent: 'leave' } }
        ],
        migrations: [
            { id: 'eslint-to-biome', applies: true, meta: { status: 'required', tracker: 'X' } },
            { id: 'commonjs-to-esm', applies: true, meta: { status: 'deferred', tracker: null } },
            { id: 'snyk', applies: false, meta: { status: 'required' } }
        ]
    };

    it('counts actions correctly', () => {
        const p = plan(inspection);
        assert.equal(p.summary.create, 1);
        assert.equal(p.summary.replace, 1);
        assert.equal(p.summary.manual, 1);
        assert.equal(p.summary.leave, 2); // identical + divergent-leave
        assert.equal(p.summary.autoApplicable, 2); // create + replace
    });

    it('includes only applicable migrations and splits required/deferred', () => {
        const p = plan(inspection);
        assert.equal(p.migrations.length, 2);
        assert.equal(p.summary.migrationsRequired, 1);
        assert.equal(p.summary.migrationsDeferred, 1);
    });

    it('renders markdown with the report header and tables', () => {
        const md = renderMarkdown(plan(inspection), { repoName: 'repo' });
        assert.match(md, /# Adoption plan — `repo`/);
        assert.match(md, /## Summary/);
        assert.match(md, /## File plan/);
        assert.match(md, /## Migrations/);
        assert.match(md, /eslint-to-biome/);
    });
});
