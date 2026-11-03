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
