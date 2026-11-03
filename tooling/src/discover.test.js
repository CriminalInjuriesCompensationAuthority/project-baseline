import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { baselinedPaths, discover, rootFiles } from './discover.js';

function makeRepo(files) {
    const dir = mkdtempSync(join(tmpdir(), 'discover-'));
    for (const [rel, content] of Object.entries(files)) {
        const abs = join(dir, rel);
        mkdirSync(join(abs, '..'), { recursive: true });
        writeFileSync(abs, content ?? '');
    }
    return dir;
}

describe('rootFiles', () => {
    it('lists root files, skipping directories and noise', () => {
        const dir = makeRepo({
            'package.json': '{}',
            'README.md': '',
            'src/index.js': '',
            'node_modules/x/y.js': ''
        });
        const files = rootFiles(dir);
        assert.ok(files.has('package.json'));
        assert.ok(files.has('README.md'));
        assert.equal(files.has('src'), false);
        assert.equal(files.has('node_modules'), false);
        rmSync(dir, { recursive: true, force: true });
    });
});

describe('baselinedPaths', () => {
    it('extracts the set of baselined file paths', () => {
        const fp = { files: [{ path: '.npmrc' }, { path: 'LICENSE' }] };
        const set = baselinedPaths(fp);
        assert.ok(set.has('.npmrc'));
        assert.ok(set.has('LICENSE'));
        assert.equal(set.size, 2);
    });
});

describe('discover', () => {
    let repos;
    afterEach(() => {
        for (const r of repos ?? []) {
            rmSync(r.dir, { recursive: true, force: true });
        }
    });

    it('computes frequency and flags high-frequency non-baselined files as candidates', () => {
        repos = [
            { name: 'a', dir: makeRepo({ 'README.md': '', '.npmrc': '', weird: '' }) },
            { name: 'b', dir: makeRepo({ 'README.md': '', '.npmrc': '' }) },
            { name: 'c', dir: makeRepo({ 'README.md': '', '.npmrc': '' }) }
        ];
        const baselined = new Set(['.npmrc']);
        const result = discover({ repos, baselined, threshold: 0.6 });

        assert.equal(result.total, 3);
        const readme = result.rows.find((r) => r.file === 'README.md');
        const npmrc = result.rows.find((r) => r.file === '.npmrc');
        const weird = result.rows.find((r) => r.file === 'weird');

        assert.equal(readme.present, 3);
        assert.equal(readme.candidate, true); // 100%, not baselined
        assert.equal(npmrc.candidate, false); // baselined
        assert.equal(weird.candidate, false); // only 33%, below threshold
    });
});
