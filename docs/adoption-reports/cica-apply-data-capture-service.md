# Adoption plan — `cica-apply-data-capture-service`

> **Status: PLAN ONLY (read-only).** No changes have been made to the target repository. This report
> is the output of the `inspect` + `plan` stages of adoption, produced against baseline `0.1.0`,
> profile `node-service`, using `policies/file-policy.yaml`.

- **Repository:** `ministryofjustice/cica-apply-data-capture-service`
- **Proposed profile:** `node-service` (target) — but see recommendation: adopt via `legacy` first
- **Reference implementation:** `ministryofjustice/cica-review-case-documents`
- **Baseline version:** 0.1.0

---

## Summary

| Outcome | Count |
| --- | --- |
| Auto-applicable (create / replace / merge) | 6 files |
| Manual review required (files) | 2 files |
| Required migrations | 5 transitions |
| Deferred / optional (not required) | 1 — CommonJS → ESM |

The quick wins (security + housekeeping files) can land in one PR immediately. The heavy lifting is
the six behaviour-changing migrations, which are tracked, human-driven steps — exactly the case the
`legacy` landing profile exists for.

---

## File-level plan

Legend: ✚ create · ♻ replace · ⤵ merge · ✋ manual · ✓ leave

| File | Target state | Baseline action | Notes |
| --- | --- | --- | --- |
| `.editorconfig` | present, missing `end_of_line = lf` | ♻ replace | Baseline adds `end_of_line = lf`; otherwise equivalent |
| `.gitattributes` | absent | ✚ create | Adds `* text=auto eol=lf` |
| `.gitignore` | present (large, has `#! m0-*` markers) | ⤵ merge | Union-lines; keep all existing entries, add any missing baseline ones. No loss |
| `.gitleaks.toml` | absent | ✚ create | New secret-scanning allowlist |
| `.c8rc.json` | absent | ✚ create (staged) | Lands with the `test:node` script; start at the repo's current 60/35 thresholds, raise to 80 as suites migrate |
| `biome.json` | absent | ✚ create | Paired with the ESLint→Biome migration (manual) |
| `.husky/pre-commit` | absent (`.huskyrc.js` present) | ✚ create | Paired with Husky v4→v9 migration (manual) |
| `.husky/pre-push` | absent | ✚ create | As above |
| `.github/dependabot.yml` | present (npm only, weekly) | ♻ replace | → "Dependabot updated": baseline adds github-actions + docker ecosystems, daily, grouped |
| `.github/workflows/tests.yml` | absent (`.circleci/` used) | ✚ create | Paired with CircleCI→GHA migration (manual) |
| `.github/workflows/sca.yml` | absent | ✚ create | Adds npm audit gate + MoJ SCA |
| `Dockerfile` | present (single-stage, custom) | ✋ manual | → "Multi-stage Docker builds": bespoke build steps; reviewed migration |
| `.project-baseline.yaml` | absent | ✚ create | Establishes baseline metadata (profile, version, org) |

### Auto-applicable now (safe, mechanical) — 1 PR

- ✚ `.gitattributes`
- ♻ `.editorconfig` (adds `eol = lf`)
- ⤵ `.gitignore` (union merge — nothing removed)
- ✚ `.gitleaks.toml`
- ♻ `.github/dependabot.yml` → **Dependabot updated**
- ✚ `.project-baseline.yaml`

> `biome.json`, `.c8rc.json`, the Husky hooks, and the two workflows are classified `create`, but
> each is **paired with a migration** below. Writing them before the matching migration would create
> config for a toolchain the repo doesn't use yet (e.g. a `biome.json` while ESLint is still active).
> The plan therefore stages them *with* their migration rather than in the quick-win PR.

---

## Migrations (behaviour-changing — all manual, human-driven)

### Required (to reach `node-service`)

| Migration | Detected by | Tracker column | Effort |
| --- | --- | --- | --- |
| **Husky v4 → v9** | `.huskyrc.js`, `husky ^4.0.3` dep | Repo Standards Applied | Low — swap to `.husky/` hooks + husky 9 |
| **Snyk → baseline security** | `.snyk` present | Repo Standards Applied | Low — drop Snyk, rely on npm audit gate + gitleaks + Dependabot |
| **CircleCI → GitHub Actions** | `.circleci/` present | **Circle removed** | Medium — add GHA callers, remove `.circleci/` once green |
| **ESLint+Prettier+airbnb → Biome** | `.eslintrc.js`, `.prettierrc.js`, `eslint-config-airbnb-base` dep | Repo Standards Applied | Medium — port custom airbnb rules into `biome.json`, remove ESLint deps/config |
| **Jest → node:test + c8** (dual-runner) | `jest.config.js`, `scripts.test = "jest"`, `jest` dep | Repo Standards Applied | High — **coexistence**: keep Jest, add `test:node`, migrate suites one at a time. Keeps CommonJS. See [guide](../migrations/jest-to-node-test.md) |

### Deferred (optional — NOT required, NOT a compliance gate)

| Migration | Detected by | Tracker column | Status |
| --- | --- | --- | --- |
| **CommonJS → ESM** | no `"type": "module"`, `require()` usage | — | **Deferred by org decision.** The repo can be fully compliant while remaining CommonJS. node:test runs under CommonJS, so this is decoupled from the test migration. See [guide](../migrations/commonjs-to-esm.md) |

---

## Tracker status (generated — mirrors the migration spreadsheet)

| Column | Current | After quick-win PR | After full adoption |
| --- | --- | --- | --- |
| Migrated | ✘ | ◼ in progress | ✔ |
| Circle removed | ✘ | ✘ | ✔ |
| Repo Standards Applied | ✘ | ◼ partial | ✔ |
| Multi-stage Docker builds | ✘ | ✘ | ✔ |
| Dependabot updated | ◼ (npm only) | ✔ | ✔ |
| Deploy updated | ✘ | ✘ | ✔ (K8s / Cloud Platform) |

---

## Recommendation

1. **Adopt onto `legacy` first.** Land the quick-win PR (6 mechanical files, including the Dependabot
   upgrade and secret scanning). Immediate security/housekeeping value, zero behaviour change.
2. **Then migrate toward `node-service`** by working the five required migrations as separate,
   reviewed PRs, in this order (lowest risk first):
   1. Husky v4 → v9
   2. Snyk → baseline security
   3. CircleCI → GitHub Actions ("Circle removed")
   4. ESLint+Prettier+airbnb → Biome
   5. Jest → node:test (dual-runner; the longest-running, done suite by suite)
3. The `biome.json`, `.c8rc.json`, Husky hooks, and workflow files land **with** their matching
   migration PR, not in the quick-win PR.
4. **ESM is not on this path.** It stays CommonJS; the ESM migration is optional and only pursued
   later if a team explicitly chooses to. The repo reaches full `node-service` compliance without it.

This proves the central concept against a real, messy repo: safe retrofit is possible, the auto vs
manual split is realistic, and the heavy migrations are surfaced rather than silently attempted.

---

## Shared-library opportunities (runtime behaviour)

These are **not** file-sync items — they are dependency adoptions (see `docs/shared-libraries.md`).
They are optional improvements surfaced by inspection, tackled as their own reviewed PRs, independent
of the file/migration path above.

| Concern in DCS today | Shared-library move | Notes |
| --- | --- | --- |
| Inline pino logger in `app.js` (minimal redaction, deprecated `prettyPrint`) | adopt `@cica/logger` `createLogger` | removes the deprecated API; gains env-driven redaction |
| Inline helmet / JSON-only CSP | `express-baseline` `applyBaselineSecurity({ flavour/csp })` | DCS keeps its looser JSON CSP via options — not forced to the web CSP |
| JSON:API error handler (`middleware/error-handler`) | `express-baseline` `baselineErrorHandlers(app, { flavour: 'jsonapi' })` | the jsonapi flavour matches DCS's existing shape; app keeps its payload specifics |
| No health endpoint | add `healthRouter()` | new baseline standard; DCS has none today |
| Env vars read raw from `process.env` | `express-baseline` `validateEnv({ mandatory, optional })` | fail-fast at boot, like the reference impl |

Not applicable to DCS: session, CSRF, rate limiting, nunjucks/static GOV.UK assets (headless API).

## Cleanup opportunities (dead code)

Inspection found code that should be **removed**, not migrated:

- `middleware/request-context` (`enrichRequestContext`) — **wired nowhere**; also contains stray
  `console.log` debug lines.
- `middleware/route-permissions` (`permissions(...)`) — **wired nowhere**.

Recommend deleting both during adoption (they add audit noise and risk). Call out in the adoption PR.

---

## What this validates for the Phase 2 gate

- **Inspect/plan works on a real legacy repo** without touching it.
- The **auto/manual classification is credible**: 6 genuinely safe changes, 8 correctly withheld for
  human review.
- The output **already populates the tracker columns**, confirming the drift report (Req 9) is a
  natural by-product of `inspect`.

**Not yet proven** (needs the `apply`/`validate` tooling and live GitHub): branch creation, PR
opening, CI run. Those require the generator/orchestration decision and credentials.
