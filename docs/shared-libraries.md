# Shared runtime libraries

This document is the record of **which cross-cutting runtime concerns are centralised into shared
libraries, which stay app-specific, and why.** It is derived from a factual survey of the real repos:

- `cica-review-case-documents` (RCD) — newest web app, ESM, the reference standard
- `cica-apply-web` (WEB) — older web app
- `cica-apply-data-capture-service` (DCS) — headless JSON:API

## Classification principle

> Centralise where the repos **agree**. Keep app-specific where they **fundamentally differ**.
> Treat pure value differences as **config/options**, not forks.

Shared *runtime behaviour* is distributed as **versioned libraries consumed as dependencies**, never
as templated `app.js`/`bin/www` (see `design.md` → "Shared runtime behaviour"). Each library is a
`node-library` repo, released by git tag, consumed via a `github:` semver ref.

## Concern-by-concern verdict

| # | Concern | Agreement across RCD / WEB / DCS | Verdict | Home |
| --- | --- | --- | --- | --- |
| 1 | Logging (pino/pino-http) | all use pino; RCD = rich factory, WEB = static instance, DCS = inline + deprecated `prettyPrint` | centralise (RCD is the model) | **`@cica/logger`** |
| 2 | helmet / CSP / HSTS | RCD ≈ WEB (nonce + strict-dynamic); DCS = looser JSON-only CSP | centralise; CSP via options | **`express-baseline`** |
| 3 | CSRF (csrf-csrf) | RCD ≈ WEB (same lib, `__Host-request-config` cookie); DCS none | centralise as opt-in | **`express-baseline`** |
| 4 | Session | express-session (RCD) vs OIDC (WEB) vs none (DCS) | **do NOT centralise** | app-specific |
| 5 | Env-var validation (fail-fast) | only RCD (`checkEnvVars`) | centralise (generalise RCD) | **`express-baseline`** |
| 6 | Error handling | HTML (RCD) vs inline HTML (WEB) vs JSON:API (DCS); only "handlers last" shared | centralise the *pattern* + two flavours; app owns the pages/shape | **`express-baseline`** (pattern) + app |
| 7 | Rate limiting (express-rate-limit) | only RCD (auth-aware keying) | centralise as opt-in | **`express-baseline`** |
| 8 | Static + GOV.UK assets + no-store | RCD ≈ WEB (both reach into `node_modules/govuk-frontend/*` by literal path — fragile); DCS minimal | centralise + fix asset resolution | **`express-baseline`** `serveStaticAssets` + **`@cica/nunjucks-govuk`** resolver |
| 9 | Health / readiness endpoint | absent everywhere | **new baseline standard** | **`express-baseline`** + scaffold |
| 10 | Template engine (nunjucks + GOV.UK/MoJ loaders) | RCD ≈ WEB (same factory contract); DCS none | centralise (web only) | **`@cica/nunjucks-govuk`** |
| 11 | Other `middleware/` | RCD mostly domain-specific (CRN/case/search/flags); DCS has orphaned dead code | **do NOT centralise** (except items already covered) | app-specific |

## The three libraries

### `express-baseline`
HTTP hardening and request-lifecycle behaviour for Express services. Composable — per-app variation
is passed as options, nothing is forked.

```js
import {
    applyBaselineSecurity,   // helmet + CSP (options.csp) + HSTS + security/Application-Version/cache headers
    validateEnv,             // fail-fast boot-time env-var validation { mandatory, optional }
    baselineErrorHandlers,   // notFound + central error handler, registered LAST (html | jsonapi flavour)
    applyCsrf,               // opt-in csrf-csrf wiring (__Host-request-config cookie); requires cookieParser
    applyRateLimit,          // opt-in express-rate-limit (auth-aware key + limits via options)
    serveStaticAssets,       // public/ + govuk-frontend assets with cache headers + no-store for dynamic
    healthRouter             // GET /health (+ /readiness) — the new baseline standard
} from '@cica/express-baseline';
```

### `@cica/logger`
The pino/pino-http logger as a configurable factory (generalised from RCD's
`middleware/logger`). Env-driven redaction, correlation-id, dev pretty-print. Separate from
`express-baseline` because **every** repo needs logging — including the headless API and
non-HTTP tools that should not pull in Express hardening.

```js
import { createLogger } from '@cica/logger';
const logger = createLogger({ level: process.env.APP_LOG_LEVEL /* , redactExtra, pretty */ });
```

### `@cica/nunjucks-govuk`
The nunjucks template-engine factory with GOV.UK + MoJ frontend loader paths and common globals
(generalised from RCD/WEB `templateEngine`). Separate because **only web apps** need it; the API
must not drag in nunjucks.

```js
import { createTemplateEngineService, resolveFrontendAssetPaths } from '@cica/nunjucks-govuk';
createTemplateEngineService(app, { loaderPaths, globals }).init();
```

It also **owns robust frontend asset resolution** (`resolveFrontendAssetPaths()`), returning the
absolute `govuk`/`moj` asset directories via `require.resolve` rather than hardcoded
`node_modules/...` paths. See "Frontend dependency direction" below.

### Frontend dependency direction (`@ministryofjustice/frontend` vs `govuk-frontend`)

**Decision:**

- **`@ministryofjustice/frontend` is the declared direct dependency.** It owns `govuk-frontend` as a
  managed transitive dependency. Apps do **not** declare `govuk-frontend` directly, and the version
  policy pins the MoJ package (`policies/versions.json` → `frontend`).
- **Apps must not reference `node_modules/govuk-frontend/*` by literal path.** Both real web apps
  currently do (`express.static(path.join(__dirname, '/node_modules/govuk-frontend/dist/...'))`).
  That reaches into a transitive dependency npm only happens to hoist — it breaks on hoisting/version
  changes and causes silent version skew (RCD resolved govuk 6.4.0, WEB 5.11.1).
- **Resolution is centralised** (option b): `@cica/nunjucks-govuk` `resolveFrontendAssetPaths()` and
  `express-baseline` `serveStaticAssets` resolve both packages' asset dirs via `require.resolve`, so
  the fragile literal paths disappear from app code and the version is governed in one place.

This is an **adoption/migration flag**: web apps on the old literal-path pattern should migrate to the
resolver, and standardise onto the approved `@ministryofjustice/frontend` major.

## Explicit non-goals (deliberately NOT centralised)

Forcing these into libraries would be over-centralisation — the repos differ for legitimate reasons:

- **Session strategy** — express-session, OIDC-managed, and stateless are three valid choices. Apps
  own this.
- **Error *response shape*** — rendered HTML vs JSON:API is a product decision. `express-baseline`
  provides the handler *pattern* and two flavours; the actual pages/payloads are app-owned.
- **Domain middleware** — CRN/case/search/feature-flag logic (RCD) is business logic, not
  cross-cutting infrastructure.
- **`app.js` / `bin/www`** — create-only scaffold; owned by the repo after generation.

## Related findings

- **DCS dead code:** `middleware/request-context` and `middleware/route-permissions` are wired
  nowhere, and `request-context` contains stray `console.log` debug lines. Flagged for removal in the
  DCS adoption report rather than migrated.
- **Health endpoints are greenfield:** none of the three repos have one, so `healthRouter()` + the
  scaffold `/health` route establish a brand-new standard rather than matching existing behaviour.
- **Frontend transitive-path anti-pattern:** web apps serve GOV.UK assets from
  `node_modules/govuk-frontend/*` while only declaring `@ministryofjustice/frontend`. Centralised
  resolution (above) fixes it; flagged for adoption. The **dependency-hygiene check** (design.md →
  "Dependency hygiene") detects this class of problem across the estate automatically.
