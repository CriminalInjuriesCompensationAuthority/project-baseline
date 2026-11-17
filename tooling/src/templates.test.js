import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildVars, substitute } from './apply.js';
import { loadBaseline } from './config.js';

const baselineRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const baseline = loadBaseline(baselineRoot);

/** Every distinct baseline source file referenced by the file policy that exists on disk. */
function templateSources() {
    const sources = new Set();
    for (const entry of baseline.filePolicy.files ?? []) {
        for (const source of [entry.source, ...Object.values(entry.sourceByProfile ?? {})]) {
            if (source && existsSync(join(baselineRoot, source))) {
                sources.add(source);
            }
        }
    }
    return [...sources];
}

describe('buildVars', () => {
    const base = {
        repoRoot: '/work/my-repo',
        baseline,
        org: 'CriminalInjuriesCompensationAuthority',
        defaultBranch: 'master',
        now: new Date('2026-11-11T10:00:00Z')
    };

    it('derives repo, org, date and branch values', () => {
        const vars = buildVars(base);
        assert.equal(vars.REPO, 'my-repo');
        assert.equal(vars.ORG, 'CriminalInjuriesCompensationAuthority');
        assert.equal(vars.YEAR, '2026');
        assert.equal(vars.ADOPTED_AT, '2026-11-11');
        assert.equal(vars.DEFAULT_BRANCH, 'master');
    });

    it('takes the baseline version and CI ref from the baseline config', () => {
        const vars = buildVars(base);
        assert.equal(vars.BASELINE_VERSION, baseline.config.baselineVersion);
        assert.equal(vars.BASELINE_REF, baseline.config.ciReusableRef ?? 'v1');
    });

    it('resolves CODEOWNERS owners from the repo org only', () => {
        const owners = baseline.config.codeowners?.[base.org] ?? [];
        assert.equal(buildVars(base).OWNERS, owners.join(' '));
        assert.equal(buildVars({ ...base, org: 'some-unmapped-org' }).OWNERS, '');
    });
});

describe('common/package-scripts.json', () => {
    const read = (rel) => readFileSync(join(baselineRoot, rel), 'utf8');
    const scripts = JSON.parse(read('common/package-scripts.json')).scripts;
    // `test` is intentionally NOT provisioned: it is repo-specific (c8 node --test, jest, ...).
    const repoSpecific = new Set(['test']);

    /** Names referenced as `npm run <name>` in a block of text. */
    const npmRunTargets = (text) => [...text.matchAll(/npm run ([\w:-]+)/g)].map((m) => m[1]);

    it('is self-contained: every `npm run X` a script references is also provisioned', () => {
        const missing = [];
        for (const [name, command] of Object.entries(scripts)) {
            for (const target of npmRunTargets(command)) {
                if (!(target in scripts) && !repoSpecific.has(target)) {
                    missing.push(`${name} -> npm run ${target}`);
                }
            }
        }
        assert.deepEqual(missing, []);
    });

    it('provides every script the central CI workflow calls', () => {
        const ci = read('.github/workflows/node-ci.yml');
        const missing = npmRunTargets(ci).filter(
            (target) => !(target in scripts) && !repoSpecific.has(target)
        );
        assert.deepEqual(missing, []);
    });

    it('provides the lint/format commands AGENTS.md tells everyone to run', () => {
        const agents = read('common/AGENTS.md');
        const documented = npmRunTargets(agents).filter(
            (t) => t.startsWith('lint') || t === 'format'
        );
        assert.ok(documented.length > 0, 'expected AGENTS.md to document lint commands');
        assert.deepEqual(
            documented.filter((target) => !(target in scripts)),
            []
        );
    });

    it('wires the Husky hooks to scripts that exist', () => {
        const hooks = ['common/.husky/pre-commit', 'common/.husky/pre-push'].flatMap((f) =>
            npmRunTargets(read(f))
        );
        assert.deepEqual(
            hooks.filter((target) => !(target in scripts)),
            []
        );
    });
});

describe('baseline templates', () => {
    it('every {{PLACEHOLDER}} used in a template is supplied by buildVars', () => {
        const supplied = Object.keys(
            buildVars({
                repoRoot: '/work/x',
                baseline,
                org: 'CriminalInjuriesCompensationAuthority',
                defaultBranch: 'main'
            })
        );
        const unresolved = [];
        for (const source of templateSources()) {
            const text = readFileSync(join(baselineRoot, source), 'utf8');
            for (const [, token] of text.matchAll(/\{\{(\w+)\}\}/g)) {
                if (!supplied.includes(token)) {
                    unresolved.push(`${source}: {{${token}}}`);
                }
            }
        }
        assert.deepEqual(unresolved, []);
    });

    it('the CI caller follows the repo default branch instead of hard-coding one', () => {
        const raw = readFileSync(join(baselineRoot, 'profiles/_shared/ci-caller.yml'), 'utf8');
        assert.equal(/branches:\s*\[\s*main\s*\]/.test(raw), false, 'hard-coded main branch');

        const render = (defaultBranch) =>
            substitute(
                raw,
                buildVars({
                    repoRoot: '/work/x',
                    baseline,
                    org: 'CriminalInjuriesCompensationAuthority',
                    defaultBranch
                })
            );
        assert.match(render('master'), /branches:\s*\[master\]/);
        assert.match(render('main'), /branches:\s*\[main\]/);
    });
});
