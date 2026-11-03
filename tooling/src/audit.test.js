import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { trackerColumns } from './audit.js';

/** Builds a minimal inspection + plan pair for trackerColumns. */
function fixture({
    migrationsApply = [],
    fileActions = {},
    fileStates = {},
    migrationsRequired = 0
} = {}) {
    const allMigrations = [
        'eslint-to-biome',
        'jest-to-node-test',
        'husky4-to-husky9',
        'snyk-to-baseline-security',
        'circleci-to-gha',
        'commonjs-to-esm'
    ];
    const inspection = {
        migrations: allMigrations.map((id) => ({ id, applies: migrationsApply.includes(id) })),
        files: Object.entries(fileStates).map(([path, state]) => ({ path, state }))
    };
    const planned = {
        files: Object.entries(fileActions).map(([path, action]) => ({ path, action })),
        summary: { migrationsRequired }
    };
    return { inspection, planned };
}

describe('trackerColumns', () => {
    it('Circle removed is ✔ when no circleci migration applies', () => {
        const { inspection, planned } = fixture({ migrationsApply: [] });
        assert.equal(
            trackerColumns({ inspection, planned, profile: 'node-service' }).circleRemoved,
            '✔'
        );
    });

    it('Circle removed is ✘ when .circleci is detected', () => {
        const { inspection, planned } = fixture({ migrationsApply: ['circleci-to-gha'] });
        assert.equal(
            trackerColumns({ inspection, planned, profile: 'node-service' }).circleRemoved,
            '✘'
        );
    });

    it('Standards is ✘ when all standards migrations apply', () => {
        const { inspection, planned } = fixture({
            migrationsApply: [
                'eslint-to-biome',
                'jest-to-node-test',
                'husky4-to-husky9',
                'snyk-to-baseline-security'
            ]
        });
        assert.equal(
            trackerColumns({ inspection, planned, profile: 'node-service' }).standardsApplied,
            '✘'
        );
    });

    it('Standards is ✔ when no standards migrations and core files compliant', () => {
        const { inspection, planned } = fixture({
            migrationsApply: [],
            fileActions: { 'biome.json': 'leave', '.c8rc.json': 'leave', '.gitleaks.toml': 'leave' }
        });
        assert.equal(
            trackerColumns({ inspection, planned, profile: 'node-service' }).standardsApplied,
            '✔'
        );
    });

    it('Standards is ◼ when partially done', () => {
        const { inspection, planned } = fixture({ migrationsApply: ['eslint-to-biome'] });
        assert.equal(
            trackerColumns({ inspection, planned, profile: 'node-service' }).standardsApplied,
            '◼'
        );
    });

    it('Multi-stage Docker is n/a for non-services', () => {
        const { inspection, planned } = fixture();
        assert.equal(
            trackerColumns({ inspection, planned, profile: 'node-library' }).multiStageDocker,
            'n/a'
        );
    });

    it('Multi-stage Docker is ✔ when Dockerfile is left (compliant)', () => {
        const { inspection, planned } = fixture({ fileActions: { Dockerfile: 'leave' } });
        assert.equal(
            trackerColumns({ inspection, planned, profile: 'node-service' }).multiStageDocker,
            '✔'
        );
    });

    it('Multi-stage Docker is ◼ when Dockerfile needs manual migration', () => {
        const { inspection, planned } = fixture({ fileActions: { Dockerfile: 'manual' } });
        assert.equal(
            trackerColumns({ inspection, planned, profile: 'node-service' }).multiStageDocker,
            '◼'
        );
    });

    it('Dependabot is ✔ when config is left, ◼ when replace, ✘ when absent', () => {
        const left = fixture({ fileActions: { '.github/dependabot.yml': 'leave' } });
        const repl = fixture({ fileActions: { '.github/dependabot.yml': 'replace' } });
        const none = fixture({ fileActions: { '.github/dependabot.yml': 'create' } });
        assert.equal(trackerColumns({ ...left, profile: 'node-service' }).dependabotUpdated, '✔');
        assert.equal(trackerColumns({ ...repl, profile: 'node-service' }).dependabotUpdated, '◼');
        assert.equal(trackerColumns({ ...none, profile: 'node-service' }).dependabotUpdated, '✘');
    });

    it('Migrated is ✔ only when all columns good and no required migrations', () => {
        const { inspection, planned } = fixture({
            migrationsApply: [],
            migrationsRequired: 0,
            fileActions: {
                'biome.json': 'leave',
                '.c8rc.json': 'leave',
                '.gitleaks.toml': 'leave',
                Dockerfile: 'leave',
                '.github/dependabot.yml': 'leave',
                '.github/workflows/tests.yml': 'leave',
                '.github/workflows/sca.yml': 'leave'
            }
        });
        assert.equal(
            trackerColumns({ inspection, planned, profile: 'node-service' }).migrated,
            '✔'
        );
    });

    it('Migrated is ◼ when some progress but required migrations remain', () => {
        const { inspection, planned } = fixture({
            migrationsApply: ['eslint-to-biome'],
            migrationsRequired: 1,
            fileActions: { '.github/dependabot.yml': 'replace' }
        });
        assert.equal(
            trackerColumns({ inspection, planned, profile: 'node-service' }).migrated,
            '◼'
        );
    });
});
