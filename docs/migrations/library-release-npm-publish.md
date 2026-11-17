# Library release workflow: opt-in npm publish

Status: **implemented** in `profiles/node-library/.github/workflows/release.yml`.

## Background

The baseline's single-package `node-library` release template used to tag and create a GitHub
Release but never publish. Meanwhile `cica-platform` (a monorepo) must publish to npm, because a
`github:` ref cannot address one package inside a monorepo. The two diverged.

The two cases are genuinely different, so the template was not simply changed to always publish:

- **Single-package libraries** (e.g. `q-router`, `q-templates-application`) are consumed by
  `github:` semver ref, which works for a one-package repo, and have no npm token or org. An
  unconditional `npm publish` would **break their release workflow**.
- **Monorepos** (`cica-platform`) must publish.

## What the template does now

`validate -> quality gate -> build -> [optional npm publish] -> tag -> GitHub Release`

- **Publishing is opt-in**, keyed on the `NPM_TOKEN` repo secret. With no token the workflow logs a
  notice (`npm publish skipped`) and creates the tag + GitHub Release only, exactly as before, so
  existing git-ref libraries are unaffected. Setting the secret turns publishing on with no
  workflow edit.
- **Publish runs before tagging**, so a tag can never point at a version that failed to publish.
- **A tag-exists check runs before publish.** Without it a re-run would publish, then fail at the tag
  step, leaving a published version with no tag.
- **Registry auth is confined to the publish step.** `setup-node` is invoked with `registry-url`
  immediately before `npm publish`, and the token is exposed only to that step (and to a tiny
  detection step that checks whether it is set). Install, test, build and audit never see it, so a
  dependency install script cannot read the publish token. Applying `registry-url` job-wide is also
  fragile: `setup-node` v7 no longer exports a placeholder `NODE_AUTH_TOKEN`, and older versions send
  a placeholder token to the registry during `npm ci`.
- **gitleaks is installed** (pinned + checksum-verified, same as `tests.yml`) before the quality
  gate. The provisioned `prepush` script runs a strict `gitleaks detect`, which fails if gitleaks is
  missing, so the release job needs it.
- The version input is passed through `env` rather than interpolated into the shell script.

## Remaining differences from `cica-platform` (intentional)

| | single-repo template | `cica-platform` (monorepo) |
| --- | --- | --- |
| Tag | `vX.Y.Z` | `<package>-vX.Y.Z` |
| Publish | opt-in (`NPM_TOKEN`) | always (it must) |
| Build step | `npm run build` | none |
| Package choice | n/a | `package` input selects a workspace |

## Prerequisites for a repo that opts in

- `NPM_TOKEN` repo secret (an npm automation token with publish rights).
- For a scoped public package: `"publishConfig": { "access": "public" }` in `package.json`.
- The package must not be `"private": true`.
- Still blocked, for the `@cica` scope, on CICA owning the `@cica` org on npmjs.com.
