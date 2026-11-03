import { inspect } from './inspect.js';
import { plan } from './plan.js';

/**
 * Status marks used in the tracker table.
 * @typedef {'✔' | '✘' | '◼' | 'n/a'} Mark
 */

/** Looks up a migration's `applies` flag by id. */
function migrationApplies(inspection, id) {
    const m = inspection.migrations.find((x) => x.id === id);
    return m ? m.applies : false;
}

/** Looks up a file's resolved action from a plan. */
function fileAction(planned, path) {
    const f = planned.files.find((x) => x.path === path);
    return f ? f.action : undefined;
}

/** True if the file is present and compliant (identical to baseline). */
function fileCompliant(inspection, path) {
    const f = inspection.files.find((x) => x.path === path);
    return f ? f.state === 'present-identical' : false;
}

/**
 * Maps an inspection + plan to the migration-tracker columns.
 * Columns mirror the existing spreadsheet so the generated report is a drop-in replacement.
 *
 * @param {object} args
 * @param {ReturnType<typeof inspect>} args.inspection
 * @param {ReturnType<typeof plan>} args.planned
 * @param {string} args.profile
 * @returns {{
 *   circleRemoved: Mark,
 *   standardsApplied: Mark,
 *   multiStageDocker: Mark,
 *   dependabotUpdated: Mark,
 *   deployUpdated: Mark,
 *   migrated: Mark
 * }}
 */
export function trackerColumns({ inspection, planned, profile }) {
    const isService = profile === 'node-service';

    // Circle removed: ✔ when no CircleCI migration applies (i.e. no .circleci present).
    const circleRemoved = migrationApplies(inspection, 'circleci-to-gha') ? '✘' : '✔';

    // Repo Standards Applied: ✔ when none of the standards migrations apply and the
    // core config files are compliant; ◼ when some progress; ✘ when none.
    const standardsMigrations = [
        'eslint-to-biome',
        'jest-to-node-test',
        'husky4-to-husky9',
        'snyk-to-baseline-security'
    ];
    const outstanding = standardsMigrations.filter((id) => migrationApplies(inspection, id)).length;
    const coreCompliant = ['biome.json', '.c8rc.json', '.gitleaks.toml'].every(
        (p) => fileCompliant(inspection, p) || fileAction(planned, p) === 'leave'
    );
    let standardsApplied;
    if (outstanding === 0 && coreCompliant) {
        standardsApplied = '✔';
    } else if (outstanding < standardsMigrations.length) {
        standardsApplied = '◼';
    } else {
        standardsApplied = '✘';
    }

    // Multi-stage Docker: service-only. ✔ when Dockerfile is compliant (leave), ◼ when
    // present-divergent (needs migration), ✘ when absent. n/a for non-services.
    let multiStageDocker;
    if (!isService) {
        multiStageDocker = 'n/a';
    } else {
        const action = fileAction(planned, 'Dockerfile');
        if (action === 'leave') {
            multiStageDocker = '✔';
        } else if (action === 'manual') {
            multiStageDocker = '◼';
        } else {
            multiStageDocker = '✘';
        }
    }

    // Dependabot updated: ✔ when the config is compliant (leave), ◼ when present-divergent
    // (replace), ✘ when absent.
    const dependabotAction = fileAction(planned, '.github/dependabot.yml');
    let dependabotUpdated;
    if (dependabotAction === 'leave') {
        dependabotUpdated = '✔';
    } else if (dependabotAction === 'replace') {
        dependabotUpdated = '◼';
    } else {
        dependabotUpdated = '✘';
    }

    // Deploy updated: service-only. Proxy: tests+sca workflows present/compliant.
    let deployUpdated;
    if (!isService) {
        deployUpdated = 'n/a';
    } else {
        const ci = ['.github/workflows/tests.yml', '.github/workflows/sca.yml'];
        const present = ci.filter((p) => fileAction(planned, p) === 'leave').length;
        deployUpdated = present === ci.length ? '✔' : present > 0 ? '◼' : '✘';
    }

    // Migrated (overall): ✔ only when everything above is ✔/n/a and no required migration remains.
    const requiredMigrationsRemain = planned.summary.migrationsRequired > 0;
    const cols = [
        circleRemoved,
        standardsApplied,
        multiStageDocker,
        dependabotUpdated,
        deployUpdated
    ];
    const allGood = cols.every((c) => c === '✔' || c === 'n/a') && !requiredMigrationsRemain;
    const noneGood = cols.every((c) => c === '✘' || c === 'n/a');
    const migrated = allGood ? '✔' : noneGood ? '✘' : '◼';

    return {
        circleRemoved,
        standardsApplied,
        multiStageDocker,
        dependabotUpdated,
        deployUpdated,
        migrated
    };
}

/**
 * Audits one repo: inspect -> plan -> tracker columns.
 *
 * @param {object} args
 * @param {string} args.repoRoot
 * @param {string} args.profile
 * @param {object} args.baseline
 * @returns {{ profile: string, columns: ReturnType<typeof trackerColumns>, summary: object }}
 */
export function auditRepo({ repoRoot, profile, baseline }) {
    const inspection = inspect({ repoRoot, profile, baseline });
    const planned = plan(inspection);
    const columns = trackerColumns({ inspection, planned, profile });
    return { profile, columns, summary: planned.summary };
}

/**
 * Renders an estate audit as a markdown tracker table + roll-up.
 *
 * @param {Array<{ name: string, profile: string|null, scope: object, result?: ReturnType<typeof auditRepo> }>} rows
 * @returns {string} Markdown.
 */
export function renderAudit(rows) {
    const lines = [];
    lines.push('# Estate audit — project-baseline');
    lines.push('');
    lines.push('> Generated by `baseline audit` (read-only). Mirrors the migration tracker.');
    lines.push('');

    lines.push('## In scope');
    lines.push('');
    lines.push(
        '| Repository | Profile | Migrated | Circle removed | Standards | Multi-stage Docker | Dependabot | Deploy |'
    );
    lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
    const inScope = rows.filter((r) => r.scope.inScope && r.result);
    for (const r of inScope) {
        const c = r.result.columns;
        lines.push(
            `| ${r.name} | ${r.profile} | ${c.migrated} | ${c.circleRemoved} | ${c.standardsApplied} | ${c.multiStageDocker} | ${c.dependabotUpdated} | ${c.deployUpdated} |`
        );
    }
    lines.push('');

    const outOfScope = rows.filter((r) => !r.scope.inScope);
    if (outOfScope.length > 0) {
        lines.push('## Out of scope');
        lines.push('');
        lines.push('| Directory | Reason |');
        lines.push('| --- | --- |');
        for (const r of outOfScope) {
            lines.push(`| ${r.name} | ${r.scope.reason} |`);
        }
        lines.push('');
    }

    // Aggregate roll-up by profile.
    lines.push('## Roll-up');
    lines.push('');
    lines.push('| Profile | repos | migrated | in progress | not started |');
    lines.push('| --- | --- | --- | --- | --- |');
    const byProfile = new Map();
    for (const r of inScope) {
        const key = r.profile;
        const agg = byProfile.get(key) ?? { repos: 0, done: 0, prog: 0, none: 0 };
        agg.repos++;
        const m = r.result.columns.migrated;
        if (m === '✔') {
            agg.done++;
        } else if (m === '◼') {
            agg.prog++;
        } else {
            agg.none++;
        }
        byProfile.set(key, agg);
    }
    for (const [profile, agg] of byProfile) {
        lines.push(`| ${profile} | ${agg.repos} | ${agg.done} | ${agg.prog} | ${agg.none} |`);
    }
    lines.push('');

    return `${lines.join('\n')}\n`;
}
