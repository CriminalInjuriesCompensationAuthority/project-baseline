# Profile: `node-library`

Publishable Node.js library / helper consumed by other CICA repos. Examples:
[`q-router`](https://github.com/CriminalInjuriesCompensationAuthority/q-router),
[`q-templates-application`](https://github.com/CriminalInjuriesCompensationAuthority/q-templates-application),
`q-template-validator`, `q-transformer`.

## How these libraries are consumed (important)

CICA libraries are **not published to the npm registry**. They are consumed directly from GitHub by
semver-tagged refs, e.g.:

```jsonc
"q-router": "github:CriminalInjuriesCompensationAuthority/q-router#semver:3.2.2",
"q-templates-application": "github:.../q-templates-application#semver:v12.4.10"
```

Consequences for this profile:

- **Release = a git tag** by default. The release workflow creates and pushes a semver tag (and a
  GitHub Release); with no further setup it does not push to a registry.
- **npm publishing is opt-in.** If the repo secret `NPM_TOKEN` is set, the same workflow also runs
  `npm publish` (before tagging, so a tag never points at an unpublished version). With no token it
  logs a notice and skips, so existing git-ref libraries are unaffected. Registry auth is applied to
  the publish step only. For a scoped public package set `"publishConfig": { "access": "public" }`.
  A **monorepo** of several packages cannot be consumed by git ref at all and must publish; see
  `cica-platform` for that variant (per-package `<package>-vX.Y.Z` tags).
- A **build step must run before consumers use the package**. Consumers install from the tag, so the
  built artifact must be present — via a committed `dist/` or a `prepare`/`prepack` build script that
  runs on install. (`q-templates-application` uses `prepare: npm run build` + a committed `dist/`.)
- `package.json` needs `main`/`exports` pointing at the built entry (e.g. `dist/template.json`).
- Tags must be **consistent**: consumers reference both `#semver:x.y.z` and `#vx.y.z` forms, so the
  release must push a `vX.Y.Z` tag that is also valid semver.

## What this profile provides

From `common/` (shared with all profiles): `.editorconfig`, `.gitattributes`, `.gitignore`,
`biome.json`, `.c8rc.json`, `.gitleaks.toml`, `.husky/` hooks.

Added by this profile:

| File | Purpose |
| --- | --- |
| `.github/workflows/tests.yml` | Node 24 + gitleaks + `npm run prepush` (same as node-service) |
| `.github/workflows/sca.yml` | npm audit gate + MoJ SCA |
| `.github/workflows/release.yml` | Tag-based release: validate, quality gate (incl. gitleaks), build, optional npm publish (when `NPM_TOKEN` is set), create `vX.Y.Z` tag + GitHub Release |
| `.github/dependabot.yml` | Standard Dependabot (npm + github-actions; **no docker** for libraries) |

**No `Dockerfile`** — libraries are not containerised. **No deploy workflow** — there is no K8s deploy.

## Placeholders to set when generating a repo

| Placeholder | Meaning | Example |
| --- | --- | --- |
| `{{MAIN_ENTRY}}` | Built entry point for `main`/`exports` | `dist/index.js` or `dist/template.json` |
| `{{BUILD_CMD}}` | Build command run by `prepare` and release | `node ./src/build.js` |

## Expected `package.json` scripts

- `build`: `{{BUILD_CMD}}`
- `prepare`: `npm run build` (ensures consumers get a built artifact on install)
- `test`: `c8 node --test` (node:test; existing Jest migrated via the dual-runner guide)
- `lint` / `lint:fix`: `biome check` / `biome check --write`
- `audit:ci`, `precommit`, `prepush`: as per the security baseline

## Notes

- Same `$schema` caveat as `node-service`: add the Biome `$schema` line in the generated repo.
- The `docker` Dependabot ecosystem is intentionally omitted from this profile's `dependabot.yml`.
