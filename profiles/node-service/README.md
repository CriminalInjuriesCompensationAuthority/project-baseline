# Profile: `node-service`

Deployable Node.js application/service. Reference implementation:
[`cica-review-case-documents`](https://github.com/ministryofjustice/cica-review-case-documents).

## What this profile provides

Files resolved in order: `common/` → `profiles/node-service/` → repo-local overrides.

From `common/` (all profiles):

| File | Purpose |
| --- | --- |
| `.editorconfig` | Editor defaults (4-space, LF, final newline) |
| `.gitattributes` | Normalise line endings to LF |
| `.gitignore` | Base ignore set (extend per repo) |
| `biome.json` | Biome lint + format config |
| `.c8rc.json` | c8 coverage thresholds (80%) |
| `.gitleaks.toml` | Secret-scanning allowlist |
| `.husky/pre-commit`, `.husky/pre-push` | Husky v9 hooks running `npm run precommit` / `prepush` |

Added by this profile:

| File | Purpose |
| --- | --- |
| `Dockerfile` | Multi-stage build on `node:24-trixie-slim`, non-root, npm/npx stripped from runtime |
| `.github/workflows/tests.yml` | Node 24 + gitleaks + `npm run prepush` |
| `.github/workflows/sca.yml` | MoJ `devsecops-actions/sca` + `npm audit --audit-level=high --omit=dev` |
| `.github/dependabot.yml` | Standard Dependabot config (from `dependabot/default.yml`) |

## Create-only scaffold (`scaffold/`)

New repos are seeded with a starter `app.js` and `bin/www` that already wire the
[`express-baseline`](#shared-runtime-behaviour) library. These are **create-only**: once generated
they belong to the repo and the baseline never overwrites them (`file-policy.yaml`:
`whenPresent: leave`). Existing repos' `app.js`/`bin/www` are never touched by adoption or sync.

## Shared runtime behaviour

Cross-cutting runtime behaviour is provided by **three versioned shared libraries** (the `@cica/*`
packages in the `cica-platform` monorepo, consumed from the npm registry by name + semver range),
**not** by templated `app.js`. Update
behaviour by bumping the dependency; per-app differences are passed as options. Full rationale and
the concern-by-concern classification are in `docs/shared-libraries.md`.

| Library | Provides | Used by |
| --- | --- | --- |
| `@cica/express-baseline` | helmet/CSP/HSTS, security headers, `validateEnv`, error-handler pattern (html/jsonapi), opt-in CSRF + rate limit, static assets, `healthRouter` | all services |
| `@cica/logger` | pino logger factory (`createLogger`) with env-driven redaction | all services |
| `@cica/nunjucks-govuk` | nunjucks + GOV.UK/MoJ loaders (`createTemplateEngineService`) | web-serving services only |

```js
import { createLogger } from '@cica/logger';
import { applyBaselineSecurity, baselineErrorHandlers, healthRouter, validateEnv } from '@cica/express-baseline';
```

**Health endpoint standard:** the scaffold wires `healthRouter()` (`GET /health`), a new baseline
standard — none of the existing repos had one. Keep it mounted before app-specific routes.

Not centralised (app-specific by design): session strategy, error response *shape*/pages, and domain
middleware. See the non-goals in `docs/shared-libraries.md`.

## Placeholders to set when generating a repo

| Placeholder | Meaning | Example |
| --- | --- | --- |
| `{{PORT}}` | Runtime port the service listens on | `5000` |
| `{{START_CMD}}` | Container entrypoint | `./bin/www` |

## Expected `package.json` scripts

This profile assumes these scripts exist (see reference impl):

- `test`: `c8 node --test` (node:test runner + c8 coverage)
- `lint` / `lint:check`: `biome check`
- `lint:fix`: `biome check --write`
- `audit:ci`: `npm audit --audit-level=high --omit=dev`
- `precommit`: secret scan + staged checks
- `prepush`: `npm test && quality checks && audit:ci`
- `prepare`: `husky`

## Notes

- `biome.json` here omits the `$schema` key. Add
  `"$schema": "https://biomejs.dev/schemas/2.5.12/schema.json"` as the first key in each generated
  repo for editor autocomplete (kept in sync with the Biome version in `policies/versions.json`).
- GitHub Actions are pinned by commit SHA; Dependabot (github-actions ecosystem) keeps them current.
