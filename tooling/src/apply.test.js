import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { computeChanges, mergeGitignore, mergeMarkerBlock, substitute } from './apply.js';

describe('substitute', () => {
    it('replaces known placeholders', () => {
        assert.equal(
            substitute('org={{ORG}} year={{YEAR}}', { ORG: 'cica', YEAR: '2026' }),
            'org=cica year=2026'
        );
    });
    it('leaves unknown placeholders intact', () => {
        assert.equal(substitute('x={{UNKNOWN}}', { ORG: 'cica' }), 'x={{UNKNOWN}}');
    });
});

describe('mergeGitignore', () => {
    it('preserves all existing lines and appends new entries', () => {
        const existing = '/node_modules\nstuff\n';
        const baseline = 'node_modules/\ncoverage/\ndist/\n';
        const merged = mergeGitignore(existing, baseline);
        assert.ok(merged.includes('/node_modules')); // original kept
        assert.ok(merged.includes('stuff')); // original kept
        assert.ok(merged.includes('coverage/')); // new added
        assert.ok(merged.includes('dist/')); // new added
        assert.ok(merged.includes('# --- added by project-baseline ---'));
    });

    it('never removes an existing entry even if not in baseline', () => {
        const existing = 'bespoke-artifact/\n';
        const merged = mergeGitignore(existing, 'coverage/\n');
        assert.ok(merged.includes('bespoke-artifact/'));
    });

    it('does not duplicate already-present entries', () => {
        const existing = 'coverage/\n';
        const merged = mergeGitignore(existing, 'coverage/\n');
        // 'coverage/' appears once; no additions block added.
        assert.equal(merged, existing);
    });

    it('skips baseline comment lines (no orphan comments)', () => {
        const existing = 'node_modules/\n';
        const merged = mergeGitignore(
            existing,
            '# Dependencies\nnode_modules/\n# New\nreally-new/\n'
        );
        assert.equal(merged.includes('# Dependencies'), false);
        assert.ok(merged.includes('really-new/'));
    });
});

describe('mergeMarkerBlock', () => {
    const marker = '<!-- end-shared -->';

    it('replaces the shared block and preserves content after the marker', () => {
        const baseline = `# Shared v2\n${marker}\n## Repo section\n`;
        const existing = `# Shared v1\n${marker}\n## My custom notes\nkeep me\n`;
        const { content, manual } = mergeMarkerBlock(existing, baseline, marker);
        assert.equal(manual, false);
        assert.ok(content.startsWith('# Shared v2'));
        assert.ok(content.includes('## My custom notes'));
        assert.ok(content.includes('keep me'));
        assert.equal(content.includes('# Shared v1'), false);
    });

    it('signals manual when existing file has no marker', () => {
        const { manual } = mergeMarkerBlock('no marker here', `shared\n${marker}\n`, marker);
        assert.equal(manual, true);
    });
});

describe('computeChanges', () => {
    let repo;
    let baselineRoot;
    beforeEach(() => {
        repo = mkdtempSync(join(tmpdir(), 'apply-repo-'));
        baselineRoot = mkdtempSync(join(tmpdir(), 'apply-base-'));
    });
    afterEach(() => {
        rmSync(repo, { recursive: true, force: true });
        rmSync(baselineRoot, { recursive: true, force: true });
    });

    function baseFile(rel, content) {
        const abs = join(baselineRoot, rel);
        mkdirSync(join(abs, '..'), { recursive: true });
        writeFileSync(abs, content);
    }
    function repoFile(rel, content) {
        const abs = join(repo, rel);
        mkdirSync(join(abs, '..'), { recursive: true });
        writeFileSync(abs, content);
    }

    function baseline(filePolicyFiles) {
        return { root: baselineRoot, filePolicy: { files: filePolicyFiles } };
    }

    it('skips leave and collects manual', () => {
        const planned = {
            files: [
                { path: 'a', action: 'leave' },
                { path: 'b', action: 'manual' }
            ]
        };
        const result = computeChanges({
            planned,
            baseline: baseline([{ path: 'b', source: 'common/b' }]),
            repoRoot: repo,
            vars: {}
        });
        assert.equal(result.changes.length, 0);
        assert.deepEqual(result.skippedManual, ['b']);
    });

    it('creates with substitution', () => {
        baseFile('common/meta', 'org={{ORG}}');
        const planned = { files: [{ path: 'meta', action: 'create' }] };
        const result = computeChanges({
            planned,
            baseline: baseline([{ path: 'meta', source: 'common/meta' }]),
            repoRoot: repo,
            vars: { ORG: 'cica' }
        });
        assert.equal(result.changes[0].content, 'org=cica');
    });

    it('demotes to manual when baseline source is missing', () => {
        const planned = { files: [{ path: 'x', action: 'create' }] };
        const result = computeChanges({
            planned,
            baseline: baseline([{ path: 'x', source: 'common/missing' }]),
            repoRoot: repo,
            vars: {}
        });
        assert.deepEqual(result.demotedToManual, ['x']);
        assert.equal(result.changes.length, 0);
    });

    it('merges .gitignore via union-lines', () => {
        baseFile('common/.gitignore', 'coverage/\n');
        repoFile('.gitignore', 'node_modules/\n');
        const planned = { files: [{ path: '.gitignore', action: 'merge' }] };
        const result = computeChanges({
            planned,
            baseline: baseline([
                {
                    path: '.gitignore',
                    source: 'common/.gitignore',
                    merge: { strategy: 'union-lines' }
                }
            ]),
            repoRoot: repo,
            vars: {}
        });
        assert.ok(result.changes[0].content.includes('node_modules/'));
        assert.ok(result.changes[0].content.includes('coverage/'));
    });

    describe('json-scripts merge', () => {
        const entry = {
            path: 'package.json',
            source: 'common/package-scripts.json',
            merge: { strategy: 'json-scripts' }
        };
        const plannedMerge = { files: [{ path: 'package.json', action: 'merge' }] };

        it('adds missing scripts to package.json and records what was added', () => {
            baseFile(
                'common/package-scripts.json',
                JSON.stringify({ scripts: { precommit: 'p', prepare: 'husky' } })
            );
            repoFile('package.json', '{\n    "scripts": {\n        "test": "t"\n    }\n}\n');
            const result = computeChanges({
                planned: plannedMerge,
                baseline: baseline([entry]),
                repoRoot: repo,
                vars: {}
            });
            assert.equal(result.changes.length, 1);
            const [change] = result.changes;
            assert.equal(change.path, 'package.json');
            assert.equal(change.action, 'merge');
            assert.equal(change.detail, 'added scripts: precommit, prepare');
            assert.deepEqual(Object.keys(JSON.parse(change.content).scripts), [
                'test',
                'precommit',
                'prepare'
            ]);
        });

        it('produces no change when every baseline script already exists', () => {
            baseFile(
                'common/package-scripts.json',
                JSON.stringify({ scripts: { precommit: 'p' } })
            );
            repoFile('package.json', '{"scripts":{"precommit":"custom"}}');
            const result = computeChanges({
                planned: plannedMerge,
                baseline: baseline([entry]),
                repoRoot: repo,
                vars: {}
            });
            assert.equal(result.changes.length, 0);
            assert.deepEqual(result.demotedToManual, []);
        });

        it('demotes to manual with a reason when a prerequisite (husky 9) is unmet', () => {
            baseFile(
                'common/package-scripts.json',
                JSON.stringify({ scripts: { prepare: 'husky' } })
            );
            repoFile('package.json', '{"devDependencies":{"husky":"^4.0.3"}}');
            const result = computeChanges({
                planned: plannedMerge,
                baseline: baseline([
                    {
                        ...entry,
                        merge: { strategy: 'json-scripts', requiresDevDependencies: { husky: 9 } }
                    }
                ]),
                repoRoot: repo,
                vars: {}
            });
            assert.deepEqual(result.demotedToManual, ['package.json']);
            assert.equal(result.changes.length, 0);
            assert.match(result.demotedReasons['package.json'], /husky/);
        });

        it('demotes to manual when package.json is not valid JSON', () => {
            baseFile(
                'common/package-scripts.json',
                JSON.stringify({ scripts: { precommit: 'p' } })
            );
            repoFile('package.json', '{ broken');
            const result = computeChanges({
                planned: plannedMerge,
                baseline: baseline([entry]),
                repoRoot: repo,
                vars: {}
            });
            assert.deepEqual(result.demotedToManual, ['package.json']);
            assert.equal(result.changes.length, 0);
        });
    });

    it('demotes marker-block merge to manual when repo file lacks the marker', () => {
        baseFile('common/AGENTS.md', 'shared\n<!-- m -->\n');
        repoFile('AGENTS.md', 'no marker');
        const planned = { files: [{ path: 'AGENTS.md', action: 'merge' }] };
        const result = computeChanges({
            planned,
            baseline: baseline([
                {
                    path: 'AGENTS.md',
                    source: 'common/AGENTS.md',
                    merge: { strategy: 'marker-block', marker: '<!-- m -->' }
                }
            ]),
            repoRoot: repo,
            vars: {}
        });
        assert.deepEqual(result.demotedToManual, ['AGENTS.md']);
    });
});
