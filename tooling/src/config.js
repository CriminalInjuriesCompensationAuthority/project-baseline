import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';

/**
 * Walks up from a starting directory to find the project-baseline root
 * (the directory containing baseline.config.yaml).
 *
 * @param {string} [startDir=process.cwd()] Directory to start searching from.
 * @returns {string} Absolute path to the baseline root.
 * @throws {Error} If no baseline.config.yaml is found up to the filesystem root.
 */
export function findBaselineRoot(startDir = process.cwd()) {
    let dir = resolve(startDir);
    while (true) {
        if (existsSync(join(dir, 'baseline.config.yaml'))) {
            return dir;
        }
        const parent = dirname(dir);
        if (parent === dir) {
            throw new Error(
                'Could not locate baseline.config.yaml (not inside a project-baseline checkout?)'
            );
        }
        dir = parent;
    }
}

/**
 * Reads and parses a YAML file.
 *
 * @param {string} path Absolute path to the YAML file.
 * @returns {unknown} Parsed content.
 */
export function readYaml(path) {
    return parseYaml(readFileSync(path, 'utf8'));
}

/**
 * Reads and parses a JSON file.
 *
 * @param {string} path Absolute path to the JSON file.
 * @returns {unknown} Parsed content.
 */
export function readJson(path) {
    return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * Loads the full baseline configuration: central config, file-policy, and version policy.
 *
 * @param {string} [root] Baseline root (auto-discovered if omitted).
 * @returns {{
 *   root: string,
 *   config: object,
 *   filePolicy: object,
 *   versions: object
 * }}
 */
export function loadBaseline(root = findBaselineRoot()) {
    const config = readYaml(join(root, 'baseline.config.yaml'));
    const filePolicy = readYaml(join(root, 'policies', 'file-policy.yaml'));
    const versions = readJson(join(root, 'policies', 'versions.json'));
    return { root, config, filePolicy, versions };
}

/**
 * Resolves the file-resolution layers for a profile (e.g. ['common/', 'profiles/node-service/']).
 *
 * @param {object} config Parsed baseline.config.yaml.
 * @param {string} profile Profile name.
 * @returns {string[]} Ordered list of source directories.
 * @throws {Error} If the profile is not registered.
 */
export function profileLayers(config, profile) {
    const entry = config?.profiles?.[profile];
    if (!entry) {
        throw new Error(`Unknown profile: ${profile}`);
    }
    return entry.files ?? [];
}

/**
 * Whether a file-policy entry applies to a given profile.
 * An entry with no `profiles` list applies to all profiles; otherwise it applies
 * only to profiles in the list.
 *
 * @param {object} entry file-policy file entry.
 * @param {string} profile Active profile.
 * @returns {boolean}
 */
export function entryAppliesToProfile(entry, profile) {
    if (!Array.isArray(entry.profiles)) {
        return true;
    }
    return entry.profiles.includes(profile);
}

/**
 * Resolves the baseline source path for a file entry under a given profile.
 * Prefers `sourceByProfile[profile]`, falling back to `source`.
 *
 * @param {object} entry file-policy file entry.
 * @param {string} profile Active profile.
 * @returns {string | undefined} Source path relative to the baseline root.
 */
export function resolveSource(entry, profile) {
    if (entry.sourceByProfile && Object.hasOwn(entry.sourceByProfile, profile)) {
        return entry.sourceByProfile[profile];
    }
    return entry.source;
}

/**
 * Returns the file-policy entries that apply to a profile, with each entry's
 * `source` resolved for that profile (so downstream code can treat it uniformly).
 *
 * @param {object} filePolicy Parsed file-policy.yaml.
 * @param {string} profile Active profile.
 * @returns {object[]} Filtered, source-resolved entries.
 */
export function resolvedFileEntries(filePolicy, profile) {
    return (filePolicy.files ?? [])
        .filter((entry) => entryAppliesToProfile(entry, profile))
        .map((entry) => ({ ...entry, source: resolveSource(entry, profile) }));
}
