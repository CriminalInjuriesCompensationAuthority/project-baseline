/**
 * Targeted merge of npm `scripts` into a repo's package.json.
 *
 * `package.json` is repo-specific (dependencies, app scripts), so it can never be created or replaced
 * wholesale and is never byte-comparable to a baseline file. This module provides the narrow
 * operation the baseline needs: make sure a known set of scripts EXISTS (e.g. the `precommit` /
 * `prepush` scripts the Husky hooks call), without disturbing anything else.
 *
 * Rules:
 *  - Matching is by script NAME only. Values are legitimately repo-specific (e.g. each repo's
 *    `prepush` composes its own test steps), so an existing script is NEVER overwritten.
 *  - Existing keys keep their order; additions are appended after the existing scripts.
 *  - Output preserves the file's detected indent and trailing-newline style.
 */

/**
 * Returns the fragment script names that the package does not define.
 *
 * @param {{ scripts?: Record<string, string> }} pkg Parsed package.json.
 * @param {{ scripts?: Record<string, string> }} fragment Parsed baseline fragment.
 * @returns {string[]} Missing script names, in fragment order.
 */
export function missingScripts(pkg, fragment) {
    const have = pkg?.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : {};
    return Object.keys(fragment?.scripts ?? {}).filter((name) => !Object.hasOwn(have, name));
}

/**
 * Lists prerequisite dependencies the package does not satisfy.
 *
 * The provisioned hook scripts only work if their tooling is installed: `prepare: husky` makes
 * `npm install` FAIL if husky is absent or is v4 (no `husky` binary), and `precommit:staged` calls
 * `biome`. The baseline cannot add the dependencies itself (no `npm install` runs, so the lockfile
 * would go stale and break `npm ci`), so it must refuse to add scripts that would break the repo.
 *
 * @param {object} pkg Parsed package.json.
 * @param {Record<string, number>} [requires] Map of package name to minimum MAJOR version.
 * @returns {string[]} Human-readable reasons; empty when all prerequisites are met.
 */
export function unmetRequirements(pkg, requires = {}) {
    const unmet = [];
    for (const [name, minMajor] of Object.entries(requires ?? {})) {
        const range = pkg?.devDependencies?.[name] ?? pkg?.dependencies?.[name];
        if (range === undefined) {
            unmet.push(`${name} (major >= ${minMajor}) is not a dependency`);
            continue;
        }
        const major = Number(String(range).match(/\d+/)?.[0]);
        if (!(major >= minMajor)) {
            unmet.push(`${name} "${range}" does not satisfy major >= ${minMajor}`);
        }
    }
    return unmet;
}

/**
 * Detects the indent of a JSON document so a rewrite keeps the repo's style.
 *
 * @param {string} text JSON text.
 * @returns {number | string} A space count, or '\t'. Defaults to 2 (npm's default) when the
 *   document has no indented line to learn from (e.g. minified).
 */
export function detectJsonIndent(text) {
    const match = text.match(/^([ \t]+)"/m);
    if (!match) {
        return 2;
    }
    return match[1].startsWith('\t') ? '\t' : match[1].length;
}

/**
 * Adds any missing baseline scripts to a package.json, leaving everything else untouched.
 *
 * @param {string} existing Current package.json text.
 * @param {string} fragmentText Baseline fragment text (`{ "scripts": { ... } }`).
 * @param {{ requires?: Record<string, number> }} [options] `requires` maps package name to the
 *   minimum major version that must already be a dependency before scripts are added.
 * @returns {{ content: string, added: string[], manual: boolean, reason?: string }} `manual: true`
 *   when the merge cannot be done safely (invalid JSON, `scripts` not an object, or unmet
 *   prerequisites, in which case `reason` says why); `content` is then the unchanged existing text.
 */
export function mergePackageScripts(existing, fragmentText, { requires } = {}) {
    let pkg;
    let fragment;
    try {
        pkg = JSON.parse(existing);
        fragment = JSON.parse(fragmentText);
    } catch {
        return {
            content: existing,
            added: [],
            manual: true,
            reason: 'package.json or the baseline fragment is not valid JSON'
        };
    }

    const scripts = pkg.scripts;
    const scriptsIsObject = scripts && typeof scripts === 'object' && !Array.isArray(scripts);
    if (scripts !== undefined && !scriptsIsObject) {
        return {
            content: existing,
            added: [],
            manual: true,
            reason: '"scripts" in package.json is not an object'
        };
    }

    const added = missingScripts(pkg, fragment);
    if (added.length === 0) {
        return { content: existing, added: [], manual: false };
    }

    const unmet = unmetRequirements(pkg, requires);
    if (unmet.length > 0) {
        return {
            content: existing,
            added: [],
            manual: true,
            reason: `prerequisites not met, so hook scripts were not added: ${unmet.join('; ')}`
        };
    }

    const merged = { ...(scriptsIsObject ? scripts : {}) };
    for (const name of added) {
        merged[name] = fragment.scripts[name];
    }
    pkg.scripts = merged;

    const trailingNewline = existing.endsWith('\n') ? '\n' : '';
    const content = `${JSON.stringify(pkg, null, detectJsonIndent(existing))}${trailingNewline}`;
    return { content, added, manual: false };
}
