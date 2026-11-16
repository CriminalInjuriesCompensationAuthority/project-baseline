# Provisioning gap: library release workflow should publish to npm

Status: **gap recorded.** The baseline's provisioned `node-library` release workflow does not yet
publish to the npm registry.

## Current state

`profiles/node-library/.github/workflows/release.yml` (what the baseline provisions into a
single-package library repo) creates a `vX.Y.Z` tag + GitHub Release and runs `npm run build`, but
has **no `npm publish` step**. Its header previously said "NOT an npm-registry publish".

Meanwhile the agreed distribution target (see `baseline.config.yaml` → `distribution.target:
npm-registry` and `docs/shared-libraries.md`) is: publish `@cica/*` packages to the npm registry so
consumers depend on them by name + semver range and Dependabot bumps them. The working reference is
`cica-platform`'s own release workflow, which:

- runs the quality gate,
- publishes to npm (`NODE_AUTH_TOKEN` from `NPM_TOKEN`, `registry-url` + scope via `setup-node`),
- **then** creates the tag and GitHub Release (publish-before-tag, so a tag never points at an
  unpublished version),
- uses a per-package tag `<package>-vX.Y.Z` (monorepo) rather than a plain `vX.Y.Z`.

## The gap

The provisioned single-repo template and the live monorepo workflow have diverged. A library repo
scaffolded from the baseline today would get a release workflow that tags but does not publish.

## Recommended fix (needs a task)

1. Add an `npm publish` step to `profiles/node-library/.github/workflows/release.yml`, using
   `setup-node` `registry-url: https://registry.npmjs.org` + `scope: "@cica"` and
   `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}`, ordered **before** the tag step.
2. Decide whether the single-repo template keeps the `npm run build` step (cica-platform has no build;
   a single-repo library may). Make it conditional or document the expectation.
3. Note the tag-format difference: single-repo = `vX.Y.Z`; monorepo (cica-platform) =
   `<package>-vX.Y.Z`. These are intentionally different and both valid.
4. Record `NPM_TOKEN` as a required secret for `node-library` repos in the provisioning docs.

Blocked on the same non-code prerequisite as cica-platform: the `@cica` npm org + an `NPM_TOKEN`.
