import { readdirSync, readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { extname, join } from 'node:path';
import { readPackageJson } from './inspect.js';

/** Node builtin module names (with and without the node: prefix). */
const BUILTINS = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`)]);

/**
 * Recursively collects source file paths in a repo (js/mjs/cjs/ts), skipping
 * node_modules, dist, coverage, etc. Capped in depth for safety.
 *
 * @param {string} repoRoot
 * @param {number} [maxDepth=6]
 * @returns {string[]} Absolute file paths.
 */
export function sourceFiles(repoRoot, maxDepth = 6, { includeTests = false } = {}) {
    const skip = new Set(['node_modules', '.git', 'coverage', 'dist', 'public', '.vscode']);
    const exts = new Set(['.js', '.mjs', '.cjs', '.ts']);
    const out = [];
    const walk = (dir, depth) => {
        if (depth > maxDepth) {
            return;
        }
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            if (entry.isDirectory()) {
                if (!skip.has(entry.name)) {
                    walk(join(dir, entry.name), depth + 1);
                }
            } else if (exts.has(extname(entry.name))) {
                // Test files often contain fixture strings (fake module names, node_modules
                // paths) that would pollute reference detection — skip them by default.
                if (!includeTests && /\.(test|spec)\.[mc]?[jt]s$/.test(entry.name)) {
                    continue;
                }
                out.push(join(dir, entry.name));
            }
        }
    };
    walk(repoRoot, 0);
    return out;
}

/**
 * Extracts imported/required package names and literal node_modules path references
 * from source text.
 *
 * @param {string} text Source code.
 * @returns {{ packages: Set<string>, nodeModulesPaths: string[] }}
 */
export function extractReferences(text) {
    const packages = new Set();
    const nodeModulesPaths = [];

    // import ... from 'pkg' | require('pkg') | import('pkg')
    const specRe = /(?:from\s+|require\(\s*|import\(\s*)['"]([^'"]+)['"]/g;
    for (const match of text.matchAll(specRe)) {
        const spec = match[1];
        if (spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('node:')) {
            continue;
        }
        packages.add(packageNameFromSpecifier(spec));
    }

    // literal node_modules/<pkg>/... path references (the govuk-frontend anti-pattern)
    const nmRe = /node_modules\/((?:@[^/'"\s]+\/)?[^/'"\s]+)/g;
    for (const match of text.matchAll(nmRe)) {
        const name = match[1];
        if (isValidPackageName(name)) {
            nodeModulesPaths.push(name);
        }
    }

    return { packages, nodeModulesPaths };
}

/**
 * Validates that a string is a plausible npm package name (filters template-literal
 * junk like `${x}` and other non-package captures).
 *
 * @param {string} name
 * @returns {boolean}
 */
export function isValidPackageName(name) {
    if (name.includes('$') || name.includes('`') || name.includes('{')) {
        return false;
    }
    return /^(?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/i.test(name);
}

/**
 * Reduces an import specifier to its package name (handles scoped packages + subpaths).
 *
 * @param {string} spec e.g. '@scope/pkg/sub' or 'pkg/sub'
 * @returns {string} e.g. '@scope/pkg' or 'pkg'
 */
export function packageNameFromSpecifier(spec) {
    const parts = spec.split('/');
    if (spec.startsWith('@')) {
        return parts.slice(0, 2).join('/');
    }
    return parts[0];
}

/**
 * Runs the dependency-hygiene checks for one repo.
 *
 * @param {string} repoRoot
 * @returns {{
 *   declared: Record<string,string>,
 *   undeclaredReferenced: string[],
 *   declaredUnused: string[],
 *   transitivePathReaches: string[]
 * } | null} null if no package.json.
 */
export function hygieneForRepo(repoRoot) {
    const pkg = readPackageJson(repoRoot);
    if (!pkg) {
        return null;
    }
    const declared = {
        ...(pkg.dependencies ?? {}),
        ...(pkg.devDependencies ?? {}),
        ...(pkg.peerDependencies ?? {})
    };
    const declaredNames = new Set(Object.keys(declared));

    const referenced = new Set();
    const nmReaches = new Set();
    for (const file of sourceFiles(repoRoot)) {
        let text;
        try {
            text = readFileSync(file, 'utf8');
        } catch {
            continue;
        }
        const { packages, nodeModulesPaths } = extractReferences(text);
        for (const p of packages) {
            referenced.add(p);
        }
        for (const p of nodeModulesPaths) {
            nmReaches.add(p);
        }
    }

    const undeclaredReferenced = [...referenced]
        .filter((p) => !declaredNames.has(p))
        .filter((p) => !BUILTINS.has(p))
        .filter((p) => !isLikelyBuiltinOrLocal(p))
        .sort();

    // Reaches into a package not in the repo's own deps = reaching through a transitive dep.
    const transitivePathReaches = [...nmReaches].filter((p) => !declaredNames.has(p)).sort();

    const declaredUnused = [...declaredNames].filter((p) => !referenced.has(p)).sort();

    return {
        declared,
        undeclaredReferenced,
        declaredUnused,
        transitivePathReaches
    };
}

/**
 * Filters out obvious false positives (type-only, tooling run via config not import).
 * Conservative: these are commonly used without a direct import.
 *
 * @param {string} name
 * @returns {boolean}
 */
function isLikelyBuiltinOrLocal(name) {
    const toolingNoImport = new Set([
        'husky',
        'c8',
        'nodemon',
        '@biomejs/biome',
        'biome',
        'eslint',
        'prettier',
        'jest',
        'webpack',
        'webpack-cli',
        'sass',
        'concurrently',
        'cross-env'
    ]);
    return toolingNoImport.has(name);
}

/**
 * Detects cross-repo version skew for dependencies declared in multiple repos.
 *
 * @param {Array<{ name: string, declared: Record<string,string> }>} repoDeps
 * @returns {Array<{ dependency: string, versions: Record<string,string[]> }>}
 *   Only dependencies with >1 distinct declared version.
 */
export function versionSkew(repoDeps) {
    const byDep = new Map(); // dep -> Map(version -> [repoName])
    for (const { name, declared } of repoDeps) {
        for (const [dep, version] of Object.entries(declared)) {
            if (!byDep.has(dep)) {
                byDep.set(dep, new Map());
            }
            const versions = byDep.get(dep);
            versions.set(version, [...(versions.get(version) ?? []), name]);
        }
    }

    const skew = [];
    for (const [dependency, versions] of byDep) {
        if (versions.size > 1) {
            skew.push({ dependency, versions: Object.fromEntries(versions) });
        }
    }
    return skew.sort((a, b) => a.dependency.localeCompare(b.dependency));
}

/**
 * Renders the dependency-hygiene report as markdown.
 *
 * @param {Array<{ name: string, hygiene: ReturnType<typeof hygieneForRepo> }>} perRepo
 * @param {ReturnType<typeof versionSkew>} skew
 * @returns {string}
 */
export function renderDeps(perRepo, skew) {
    const lines = [];
    lines.push('# Dependency hygiene — project-baseline');
    lines.push('');
    lines.push(
        '> Generated by `baseline deps` (read-only). Advisory — findings feed reviewed PRs.'
    );
    lines.push('');

    lines.push('## Undeclared but referenced');
    lines.push('');
    lines.push(
        '> Heuristic — may include false positives from template-macro imports (e.g. nunjucks ' +
            '`{% from %}`) or re-exported local names. Review before acting.'
    );
    lines.push('');
    lines.push('| Repository | Package |');
    lines.push('| --- | --- |');
    let anyUndeclared = false;
    for (const { name, hygiene } of perRepo) {
        for (const p of hygiene?.undeclaredReferenced ?? []) {
            lines.push(`| ${name} | \`${p}\` |`);
            anyUndeclared = true;
        }
    }
    if (!anyUndeclared) {
        lines.push('| _none_ | |');
    }
    lines.push('');

    lines.push('## Transitive-path reaches (node_modules/<pkg> not declared)');
    lines.push('');
    lines.push('| Repository | Package reached |');
    lines.push('| --- | --- |');
    let anyReach = false;
    for (const { name, hygiene } of perRepo) {
        for (const p of hygiene?.transitivePathReaches ?? []) {
            lines.push(`| ${name} | \`${p}\` |`);
            anyReach = true;
        }
    }
    if (!anyReach) {
        lines.push('| _none_ | |');
    }
    lines.push('');

    lines.push('## Cross-repo version skew');
    lines.push('');
    if (skew.length === 0) {
        lines.push('_No skew detected._');
    } else {
        lines.push('| Dependency | Versions (repos) |');
        lines.push('| --- | --- |');
        for (const s of skew) {
            const detail = Object.entries(s.versions)
                .map(([v, repos]) => `${v} (${repos.join(', ')})`)
                .join('; ');
            lines.push(`| \`${s.dependency}\` | ${detail} |`);
        }
    }
    lines.push('');

    return `${lines.join('\n')}\n`;
}
