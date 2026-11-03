# Design — Project Baseline

## Overview

Project Baseline is a central GitHub repository plus a set of automation workflows that act as the
single source of truth for engineering standards across the organisation's Node.js repositories. It
drives three lifecycle operations from the same definitions:

- **create** — generate a new repository that conforms to the baseline.
- **adopt** — retrofit an existing repository safely, via an inspect → plan → apply → validate flow.
- **maintain** — propagate central changes to all managed repositories as reviewable pull requests.

The design deliberately separates two concerns that behave differently:

| Concern | Mechanism | Safety characteristic |
| --- | --- | --- |
| **Shared files** (static config, workflows, scaffolding) | Template engine + sync | Can be generated/merged/overwritten per explicit policy |
| **Dependency versions** | Dependabot + central version policy | Must be proposed and tested, never force-applied |

Mixing these is the most common failure mode. Keeping them on separate rails lets static files be
force-synced where appropriate while dependency changes always flow through tested update PRs.

### Target standard and reference implementation

This design targets the real CICA estate, which spans two GitHub organisations
(`ministryofjustice` and `CriminalInjuriesCompensationAuthority`). The newest repository,
**`cica-review-case-documents`**, already embodies the target standard and is the **reference
implementation** that other repositories converge toward:

| Dimension | Target (reference impl) | Common legacy state to migrate from |
| --- | --- | --- |
| Node | latest LTS (`>=24`) | mixed (`>=16` … `>=24`) |
| Lint/format | **Biome** (flat config) | ESLint 8 + Prettier + airbnb-base (`.eslintrc.js`) |
| Tests | **node:test + c8** (`c8 node --test`), via dual-runner migration | Jest |
| Modules | CommonJS (ESM optional/deferred — not required) | CommonJS |
| CI/CD | **GitHub Actions** (enforced) | CircleCI (`.circleci/`) |
| Dependencies | **Dependabot** | Snyk / ad-hoc / Dependabot |
| Security | `npm audit` gate + gitleaks | varies |
| Hooks | Husky v9 (`.husky/`) | Husky v4 (`.huskyrc.js`) |

New Jest suites are not added; existing Jest tests remain until a repo is migrated. Biome is the
lint/format target even though most repos still run ESLint+Prettier — the baseline pulls them forward
toward the reference implementation, it does not freeze them at the legacy state.

### Design principles

1. **One source of truth.** New repos and legacy repos are maintained by the same definitions.
2. **Baseline = minimum, not mandate.** Profiles express legitimate variation; the system never
   requires byte-identical repos.
3. **Nothing lands without review.** All changes to managed repos arrive as PRs with CI, never direct
   pushes to default branches.
4. **Non-destructive by default.** Adoption inspects and plans before it touches anything, and never
   silently overwrites divergent files.
5. **Composable profiles.** Near-identical files live in `common/`; profiles add only their deltas.

---

## Architecture

### High-level components

```
                         ┌─────────────────────────────────────────┐
                         │          project-baseline (repo)         │
                         │                                          │
                         │  common/        shared files (all repos) │
                         │  profiles/      per-type overrides       │
                         │  policies/      governance + version     │
                         │  workflows/     reusable CI/CD            │
                         │  renovate/      shared Renovate preset    │
                         │  tooling/       create / adopt / audit    │
                         └───────────────┬──────────────────────────┘
                                         │  (same definitions)
            ┌────────────────────────────┼────────────────────────────┐
            ▼                            ▼                            ▼
       create                        adopt                        maintain
   (new repository)          (existing repository)         (all managed repos)
            │                            │                            │
            ▼                            ▼                            ▼
   generated repo w/           inspect → plan → apply →        standard change →
   baseline metadata           PR + CI validation             update PRs + CI
```

### Repository layout

```
project-baseline/
├── common/                     # files shared by (almost) every profile
│   ├── .editorconfig
│   ├── .gitignore
│   ├── .gitattributes
│   ├── tsconfig.base.json
│   └── README.scaffold.md
├── profiles/
│   ├── node-service/           # deployable application/service
│   ├── node-library/           # publishable shared library/helper
│   ├── github-action/          # a GitHub Action repo
│   └── legacy/                 # reduced transitional standard
├── policies/
│   ├── versions.json           # approved dependency version policy (per profile)
│   ├── governance.yaml         # rulesets / branch protection / required checks
│   ├── security.yaml           # npm audit level, gitleaks config, required checks
│   └── file-policy.yaml        # per-file adopt behaviour: create|merge|replace|manual
├── workflows/                  # reusable GitHub Actions workflows (ci, release, etc.)
├── dependabot/
│   └── default.yml             # standard dependabot.yml provisioned to every repo
├── security/
│   └── gitleaks.toml           # shared gitleaks config
├── tooling/                    # create / adopt / sync / audit automation
└── baseline.config.yaml        # version of the baseline + profile registry + org list
```

### Baseline metadata in managed repos

Every managed repository carries a small metadata file (working name
`.project-baseline.yaml`) recording:

```yaml
baselineVersion: 1.4.0      # which version of the standards it was aligned to
profile: node-service       # which profile governs it
org: ministryofjustice      # which GitHub org the repo lives in
adoptedAt: 2026-11-02       # first adoption/creation date
managed: true               # opt-in flag for the sync fleet
```

This file is what makes create, adopt, and maintain share one source of truth: the maintenance
process reads `profile` + `baselineVersion` to compute the correct diff for each repo, regardless of
whether the repo was generated new or retrofitted.

---

## Profiles

Profiles are composed, not copied. Resolution order for a given repo:

```
common/  →  profiles/<profile>/  →  repo-local overrides (left alone during adopt)
```

All current profiles share the target toolchain: Biome config, `c8`+node:test setup, ESM, Husky v9,
`dependabot.yml`, gitleaks config, GitHub Actions caller workflows, and the `npm audit` gate.

| Profile | Target repos | Notable additional contents |
| --- | --- | --- |
| `node-service` | Deployable apps/services (e.g. `cica-apply-web`, `cica-apply-data-capture-service`) | Dockerfile (multi-stage) + MoJ Cloud Platform base image, `kube_deploy/` + deploy workflow |
| `node-library` | Publishable libraries/helpers (e.g. `q-router`, `q-templates-application`) | npm/git-tag release workflow, `main`/`exports`, build step, no Dockerfile |
| `github-action` | GitHub Action repos | `action.yml` scaffold, action build/release workflow |
| `legacy` | Not yet meeting a current profile | Reduced subset: lint/test/CI + security baseline only; keeps Jest/ESLint until migrated |

`legacy` exists to give old repos a safe first landing point. A repo adopts `legacy`, then migrates to
`node-service`/`node-library` as an explicit, reviewed profile change (Req 2.5).

Keep profiles as small as practical. If two profiles contain a near-identical file, it belongs in
`common/` with a small profile-specific override rather than being duplicated (Req 2.3).

---

## Tooling evaluation (decision gated by POC — Req 10)

The hardest requirement is **safe retrofit of un-templated legacy repos** (Req 4). The tool choice is
evaluated against that, not assumed.

| Capability | Copier | Projen |
| --- | --- | --- |
| Generate new repo from template | Strong | Strong |
| Update previously-templated repo | Strong (answers file + versioned template) | Strong (regenerate from code) |
| **Retrofit a repo with no prior template metadata** | **Weak** — update assumes valid `.copier-answers.yml`; you cannot honestly backfill it onto an arbitrary old repo | **Weak/different** — expects the repo to be defined *by* Projen (`.projenrc`), i.e. a bigger adoption cost |
| Managing arbitrary static files | Good | Opinionated (files are generated from code) |
| Learning curve / lock-in | Lower, template-centric | Higher, code-as-config, more lock-in |

**Observations:**

- Copier's update mechanism assumes the repo was generated from a versioned template and has valid
  Copier metadata. Adding `.copier-answers.yml` to an arbitrary old repo and pretending it was always
  managed is unsafe.
- Projen makes every file a *generated artifact* defined in `.projenrc`. Powerful for greenfield and
  for repos willing to be Projen-defined, but adopting 20 heterogeneous legacy repos into Projen is a
  large, invasive change.

**Implication for design:** neither tool solves retrofit out of the box. Project Baseline therefore
owns an explicit **adoption layer** (below) that sits *around* the chosen generator. The generator
handles `create`; the adoption layer handles the safe inspect/plan/apply for `adopt`. The POC
(Req 10) is the gate that decides which generator we build that layer around. Recommended POC bias:
Copier for `create` (lower lock-in, file-centric), with the custom adoption layer carrying the
retrofit weight — but this is explicitly to be proven, not assumed.

---

## Adoption lifecycle (the core of safe retrofit)

Adoption is a four-stage state machine. It is non-destructive until the final PR, and never writes to
the default branch (Req 4.3).

```
   ┌─────────┐     ┌────────┐     ┌────────┐     ┌──────────┐
   │ INSPECT │ ──▶ │  PLAN  │ ──▶ │ APPLY  │ ──▶ │ VALIDATE │
   └─────────┘     └────────┘     └────────┘     └──────────┘
   read-only       report only    branch only    CI + open PR
```

### 1. Inspect (read-only)

Compare the repo against its (chosen or detected) profile:

- Which standard files are present / missing / divergent.
- Node version, linter, test runner, CI setup, Dockerfile/base image, `.gitignore`, etc.
- Current dependency versions vs approved policy.

Produces a structured inspection result; modifies nothing (Req 9.2).

### 2. Plan (report only)

Turn the inspection into an **adoption report** driven by `policies/file-policy.yaml`, classifying
each item as one of:

- **create** — file absent → add it.
- **replace** — file present but safe to overwrite (e.g. `.editorconfig`).
- **merge** — file present and must be combined (e.g. `.gitignore`, `package.json` scripts).
- **manual** — divergence that needs a human decision (e.g. custom CI, bespoke `tsconfig`).
- **leave** — already compliant or legitimately repo-specific.

Example report (modelled on `cica-apply-data-capture-service`, a real legacy target):

```
Repository: cica-apply-data-capture-service  (org: ministryofjustice)
Profile:    node-service   (baseline 1.4.0)

✔ engines.node >= 24           already compliant
✘ ESLint+Prettier+airbnb → Biome   (replace: biome.json; manual: port custom airbnb rule overrides)
✘ Jest → node:test + c8            (manual: dual-runner; migrate suites one at a time, stays CommonJS)
· CommonJS → ESM                   (deferred: optional, not required, not a compliance gate)
✘ CircleCI → GitHub Actions        (manual: "Circle removed" — add GHA caller, remove .circleci/)
✘ Dockerfile → multi-stage + CP    (manual: "Multi-stage Docker builds")
✘ Dependabot config → standard     (replace: .github/dependabot.yml  → "Dependabot updated")
✘ npm audit gate + gitleaks        (create: audit:ci script, .gitleaks.toml, husky v9 hooks)
✔ .editorconfig / .gitignore       comply

Proposed changes: 4 files   Manual review required: 5 items
```

The classification respects the migration's real cost: mechanical items (Dependabot config,
gitleaks, editorconfig) are auto-applied; invasive migrations (Jest→node:test, CircleCI→GHA,
ESLint→Biome, multi-stage Docker) are flagged `manual` so a human drives them. This is why `legacy`
exists as a landing profile — a repo can adopt the security/dependency/lint-config quick wins
immediately and tackle the heavy migrations as tracked, reviewed steps.

Two migrations get special handling (see `docs/migrations/` and Requirement 12):

- **Jest → node:test is a dual-runner coexistence migration**, not a swap. Both runners run in CI
  while suites move across one at a time; Jest's env setup and coverage thresholds are preserved into
  `.env.test`/`.c8rc.json`. node:test runs under CommonJS, so it needs no ESM.
- **CommonJS → ESM is deferred and optional.** It is decoupled from the test migration and is *not* a
  compliance gate — a repo stays fully compliant as CommonJS. ESM is pursued only if a team opts in.

### 3. Apply (branch only)

- Create branch `baseline/adopt-<baselineVersion>`.
- Apply only `create`/`replace`/`merge` actions.
- Write `.project-baseline.yaml` metadata (Req 4.6) — this is the explicit, correct establishment of
  baseline metadata for a previously-unmanaged repo.
- Leave `manual`/`leave` items untouched; list `manual` items in the PR body as reviewer TODOs.

### 4. Validate (CI + PR)

- Push branch, open a PR showing the full diff (Req 4.4).
- CI runs against the branch (Req 4.7). PR body embeds the adoption report and the manual-review
  checklist.
- Human reviews and merges. Nothing reaches the default branch without this.

---

## Create flow (new repositories)

1. Developer invokes creation for a chosen profile, answering a few prompts (name, profile,
   deployment option) — Req 3.2.
2. Generator renders `common/` + `profiles/<profile>/` with answers substituted.
3. Write `.project-baseline.yaml` with current `baselineVersion` + `profile` (Req 3.3).
4. Where provisioning is automated: create the GitHub repo and apply `policies/governance.yaml`
   settings for the profile — rulesets, required checks, permissions (Req 3.4, Req 8).

Because the generated repo carries the same metadata as an adopted repo, it is maintained by the
identical sync path afterwards (Req 5.5).

---

## Ongoing synchronisation (maintain)

A scheduled / change-triggered workflow in `project-baseline`:

1. Enumerate managed repos (those with `managed: true`) across **both** orgs
   (`ministryofjustice` and `CriminalInjuriesCompensationAuthority`).
2. For each, read `org` + `profile` + `baselineVersion`.
3. Compute the delta between the repo's recorded version and the current baseline for its profile.
4. Open an update PR per affected repo on branch `baseline/sync-<baselineVersion>`, bump the metadata
   version, run CI (Req 5.1–5.3).
5. Require review before merge (Req 5.4).

Because step 3 is keyed on `profile` + `baselineVersion`, a freshly created repo and a retrofitted
legacy repo receive **equivalent** update PRs for the same standard change (Req 5.5, Req 10.1).

```
central standard change ─┬─▶ repo A (created new)   ─▶ sync PR  ─▶ CI ─▶ review
                         ├─▶ repo B (adopted legacy)─▶ sync PR  ─▶ CI ─▶ review
                         └─▶ repo C (not affected)  ─▶ no PR
```

---

## Dependency management (Dependabot)

Dependencies ride a separate rail from static-file sync (Req 6.5).

- `dependabot/default.yml` in `project-baseline` is the **standard config** provisioned into every
  managed repo as `.github/dependabot.yml` (Req 6.2). The newer repos already carry a `dependabot.yml`;
  the baseline brings all repos onto one agreed configuration.
- Approved version policy (Node LTS, shared `engines` floor, grouping/scheduling preferences) lives in
  `policies/versions.json`, per profile where relevant (Req 6.1).
- Unlike a Renovate preset, Dependabot has no central `extends` mechanism, so the config is treated as
  a **standard shared file** kept aligned through the normal sync path rather than inherited at
  runtime (Req 6.3). A missing/outdated `dependabot.yml` is reported as drift and fixed via PR,
  tracked as the **"Dependabot updated"** status (Req 6.4).
- Dependabot update PRs are tested by CI (including the `npm audit` gate) before merge.

This keeps "a static file can be force-synced" and "a dependency bump must be proposed and tested" as
distinct, correctly-handled flows.

## Security and audit

Security checks are part of the baseline toolchain, modelled on the reference implementation
(`cica-review-case-documents`):

- **`npm audit` gate** — `npm audit --audit-level=high --omit=dev` as an `audit:ci` script and a
  required CI check. The severity threshold is centrally configurable in `policies/security.yaml`,
  defaulting to `high` (Req 11.1, 11.4).
- **gitleaks** — shared `security/gitleaks.toml`, wired into Husky v9 pre-commit/pre-push hooks and a
  CI job for secret scanning (Req 11.2).
- **Dependabot** — automated vulnerability/update PRs (Req 11.3, cross-refs Dependency management).
- A repo missing any required security check is reported as drift and can be brought up via PR
  (Req 11.5). Older repos using Snyk (`.snyk`) are migrated to this standard as a reviewed step.

---

## Shared runtime behaviour: a library, not a templated `app.js`

A recurring question is whether shared *runtime* code — helmet/CSP configuration, security headers,
environment-variable validation, the standard error-handling pattern, and the `app.js` / `bin/www`
bootstrap — should be baseline files that every repo copies.

**Decision: no. Shared runtime behaviour is distributed as a versioned shared library
(`express-baseline`), consumed as a dependency. `app.js` and `bin/www` are NOT templated, synced, or
owned by the baseline.**

### Why not template `app.js` / `bin/www`

Comparing the two real reference points shows these files are legitimately divergent:

- `cica-review-case-documents` (web app): nonce + `strict-dynamic` CSP, `express-session`,
  `csrf-csrf`, rate limiter, feature flags, GOV.UK assets, multiple routers.
- `cica-apply-data-capture-service` (headless API): looser JSON-only CSP, no session, no CSRF,
  OpenAPI validator, pino redaction, JSON:API content type.

They share only a thin band of common *intent* wrapped around a lot of app-specific wiring. Three
problems make these files unsafe to baseline as copied templates:

1. **They diverge immediately and legitimately** — an API's CSP *should* differ from a web app's. A
   copied baseline would be wrong for most repos the moment it lands.
2. **Middleware order is load-bearing and security-sensitive** — CSRF after session, rate limiter
   after auth mount, error handler last. A file-sync/merge tool cannot safely reconcile this; a bad
   reorder is a security bug.
3. **They are the application, not the scaffold** — baselining them makes the central repo own product
   code, so every app change fights the sync tool.

### What we baseline instead

The *posture* that should be consistent (hardened helmet/CSP defaults, HSTS, `Application-Version`
and cache-control headers, env-var validation, the notFound/error-handler pair) ships as a shared
library with a small composable API. Per-app variation is a function argument, not a fork:

```js
// app.js — stays app-specific and app-owned
import { applyBaselineSecurity, baselineErrorHandlers } from '@cica/express-baseline';

const app = express();
applyBaselineSecurity(app, { csp: { /* per-app directives */ } }); // helmet, HSTS, headers
// ... app-specific routers / middleware (the part that legitimately varies) ...
baselineErrorHandlers(app); // notFound + error handler, applied last
```

Benefits over a templated file:

- Updates propagate like any dependency (Dependabot bump + CI), with no file-merge conflicts or
  drift-report noise.
- Security fixes are a single library release that every consumer picks up on the next bump.
- It reuses the architecture already in place: `express-baseline` is a `node-library` repo, released
  by git tag, consumed via a `github:` ref.

### The one concession: a create-only scaffold

To keep "a new project starts fast", the `node-service` profile ships a **starter `app.js` skeleton**
(and `bin/www`) that already wires the shared libraries plus a placeholder router. These are
**create-only**: `file-policy.yaml` marks them `whenAbsent: create`, `whenPresent: leave`. A new repo
gets a running start; an existing repo's working `app.js`/`bin/www` is never touched by adoption or
sync.

### The three shared libraries

A survey of the real repos (RCD web app, WEB web app, DCS headless API) classified every
cross-cutting runtime concern by how much the repos actually agree. The result is **three** libraries,
split by what travels together. Full rationale and per-concern verdicts live in
`docs/shared-libraries.md`.

| Library | Scope | Why separate |
| --- | --- | --- |
| **`express-baseline`** | helmet/CSP/HSTS, security headers, env validation, error-handler pattern (html + jsonapi), opt-in CSRF, opt-in rate limit, static-asset helper, health router | the HTTP hardening layer for services |
| **`@cica/logger`** | pino/pino-http factory with env-driven redaction + correlation id | every repo needs logging, including the API and non-HTTP tools that must not pull in Express hardening |
| **`@cica/nunjucks-govuk`** | nunjucks factory + GOV.UK/MoJ loader paths + globals | only web apps need it; the API must not drag in nunjucks |

Concern classification (condensed):

| Concern | Verdict |
| --- | --- |
| Logging | `@cica/logger` |
| helmet/CSP/HSTS, CSRF, env validation, rate limit, static assets, health | `express-baseline` |
| Template engine (nunjucks) | `@cica/nunjucks-govuk` |
| Error-handler *pattern* | `express-baseline`; the response *shape*/pages stay app-owned |
| **Session**, **error response shape**, **domain middleware**, **`app.js`/`bin/www`** | **not centralised — app-specific** |

The non-goals are deliberate: session strategy (express-session vs OIDC vs stateless), error response
shape (HTML vs JSON:API), and domain middleware (CRN/case/search) differ for legitimate reasons and
forcing them into a library would be over-centralisation. Health endpoints are *greenfield* — absent
in all three repos — so `healthRouter()` plus the scaffold `/health` route establish a new standard.

---

## Shared CI/CD (reusable workflows)

- Pipelines live once in `project-baseline/workflows/` as **reusable workflows** (Req 7.1).
- Each managed repo has a thin caller workflow that references the central reusable workflow
  (`uses: org/project-baseline/.github/workflows/ci.yml@<ref>`) rather than embedding the full
  pipeline (Req 7.2).
- Changing the central workflow propagates through the normal sync path — callers pinned to a moving
  ref update automatically where allowed, or receive a sync PR to bump the pinned ref (Req 7.3).

---

## Governance and settings

- `policies/governance.yaml` defines, per profile: branch protection / rulesets, required status
  checks, and permission model (Req 8.1).
- Automated provisioning applies these at create time and can reconcile them during sync/audit
  (Req 8.2).
- Settings are versioned and reviewed in `project-baseline`, not configured out-of-band (Req 8.3).
  Organisation-level rulesets back-stop per-repo settings.

---

## Drift reporting (audit)

An `audit` operation reuses the adoption **Inspect** stage across all managed repos without applying
changes (Req 9.2). It **replaces the hand-maintained migration-tracker spreadsheet** by generating
the same columns automatically (Req 9.4, 9.5):

- For each repo: org, profile, recorded `baselineVersion`, and pass/fail per tracked standard.
- Output in the tracker's shape so it is a drop-in replacement for the current spreadsheet, and an
  aggregate roll-up to prioritise the largest gaps (Req 9.1, 9.3).

Per-repo report (columns mirror the existing tracker):

```
Repository                          Prio  Migrated  Circle    Standards  Multi-stage  Dependabot  Deploy
                                                     removed   applied    Docker       updated     updated
──────────────────────────────────────────────────────────────────────────────────────────────────────
moj/cica-apply-web                  High   ✔        ✔         ✔          ✔            ✔           ✔
moj/cica-apply-data-capture-service High   ✔        ✔         ✔          ◼ partial    ✔           ✔
cica/q-router                       Med    ◼        ◼         ◼          n/a          ✘           n/a
cica/q-templates-application        Med    ◼        ◼         ◼          n/a          ✘           n/a
cica/q-transformer                  Med    ◼        ◼         ◼          n/a          ✘           n/a
...
```

Aggregate roll-up:

```
Estate drift (~12 repos, 2 orgs)         baseline 1.4.0
────────────────────────────────────────────────────
profile        repos   on-version   behind   unmanaged
node-service      4         2          2          0
node-library      6         1          5          0
github-action     1         0          1          0
legacy            1         0          1          0
```

### Shared-file discovery (keeping the baseline evidence-driven)

The baseline's `common/`/profile file set must not be a hand-curated guess from a handful of repos —
that risks missing files that are in fact shared across the estate. A **shared-file discovery** mode
of `audit` computes a **file-frequency matrix** across *all* in-scope repos:

- Enumerate root-level files/configs (and selected directories) in every in-scope repo.
- Count how many repos contain each path, and whether contents are identical / similar / divergent.
- Surface two actionable lists:
  - **Candidate baseline additions** — a file present in a high proportion of repos (e.g. ≥ 80%) but
    *not* in `common/` or a profile. (This is exactly how `.npmrc`, `LICENSE`, `SECURITY.md`, and
    `AGENTS.md` were found to be missing from an initial 4-repo sample.)
  - **Unexpected divergence** — a baselined file that a repo overrides without a declared `override`.

```
Shared-file frequency (in-scope Node repos)
───────────────────────────────────────────────────────────
path              present   identical   in baseline?   action
.npmrc              20/20       20          yes          ok
LICENSE             20/20       19          yes          ok
.editorconfig       18/20       12          yes          review formatting drift
.dockerignore       11/12 svc    6          yes(svc)     ok
CONTRIBUTING.md      3/20        -          no           candidate? (low freq -> no)
<newly-seen-file>    17/20       15          NO           CANDIDATE ADDITION
```

This runs read-only, initially over locally-available repos and later over the full GitHub estate via
the same fleet-enumeration used by `sync`. It turns "did we capture everything shared?" from a
judgement call into a generated, reviewable report, and should be run before each baseline version
bump.

### Dependency hygiene (the discovery audit's sibling check)

The same read-only estate scan also inspects `package.json` + lockfile + source to surface
dependency problems that static-file inspection misses. It was prompted by a real finding: web apps
serve assets from `node_modules/govuk-frontend/*` while only declaring `@ministryofjustice/frontend`
— a reach into an undeclared transitive dependency, plus silent version skew across repos. Four
checks:

1. **Undeclared-but-referenced** — a package imported/`require`d or referenced by path (including
   `node_modules/<pkg>/*` literal paths) that is *not* in the repo's own `dependencies`. (This is the
   govuk-frontend case.)
2. **Declared-but-unused** — a dependency in `package.json` with no import/reference anywhere (dead
   weight, larger attack surface).
3. **Cross-repo version skew** — the same dependency pinned at materially different versions across
   repos, especially where policy expects alignment (e.g. `@ministryofjustice/frontend` ^5 vs ^11).
4. **Transitive-path reaches** — any literal `node_modules/<transitive>/*` path, which breaks on
   hoisting/dedupe changes. Flag to move behind a resolver or declare the dep directly.

```
Dependency hygiene (in-scope Node repos)
──────────────────────────────────────────────────────────────────
check                     repo                      detail
undeclared-but-referenced cica-apply-web            govuk-frontend used via node_modules path, not declared
undeclared-but-referenced cica-review-case-documents govuk-frontend used via node_modules path, not declared
version-skew              @ministryofjustice/frontend  ^5 (web) vs ^11 (rcd)  -> standardise to ^11
transitive-path-reach     cica-apply-web, rcd       node_modules/govuk-frontend/dist/... in app.js
declared-but-unused       (per-repo)                e.g. eslint-plugin-jest after Jest migration
```

Hygiene findings are **advisory inputs to adoption/sync** (they become reviewed PRs — dependency
changes never force-apply), and overlap deliberately with the shared-library work: the govuk-frontend
reaches are resolved by `@cica/nunjucks-govuk`, and leftover `eslint*`/`jest*` deps are cleaned up by
the Biome/test migrations.

---

## Proof of concept (gate — Req 10)

One complete cycle must be demonstrated before full build-out:

1. **Create** a new `node-service` repo from the profile.
2. **Adopt** `cica-apply-data-capture-service` (real, still on CircleCI/Jest/ESLint) via
   inspect → plan → apply → PR, using `cica-review-case-documents` as the target reference.
3. **Change** a central standard and show **both** repos receive equivalent update PRs.

If safe retrofit cannot be done reliably, the generator/tooling choice is reconsidered before
proceeding (Req 10.4). Success validates the central concept and gives a foundation that can clean up
the estate progressively, without a disruptive wholesale migration.

---

## Key design decisions & trade-offs

| Decision | Rationale | Trade-off |
| --- | --- | --- |
| Separate static-file sync from dependency sync | Different safety profiles | Two mechanisms to operate |
| Custom adoption layer around the generator | No generator safely retrofits un-templated repos | Bespoke code to maintain |
| `legacy` profile | Safe landing for old repos; incremental migration | Temporary duplication of a reduced standard |
| Biome as target (not ESLint+Prettier) | Reference impl already moved; fewer config files | Most repos must migrate lint config |
| Dependabot (not Renovate) | Matches existing repos + tracker | No central `extends`; config synced as a file |
| `@ministryofjustice/frontend` as the declared dep; govuk-frontend transitive; asset paths resolved by the shared library (not literal `node_modules` paths) | MoJ frontend is the intended dep and owns govuk-frontend; literal transitive paths are fragile + cause version skew | Web apps must migrate off the literal-path pattern |
| Invasive migrations flagged `manual` | Jest→node:test, CircleCI→GHA, ESLint→Biome are not safe to auto-apply (ESM is deferred/optional) | Human effort per repo; slower convergence |
| Metadata file in each repo | Lets create + adopt share one maintenance path | Repos must carry an extra managed file |
| Reusable workflows over copied pipelines | Central update, consistency | Repos depend on the central repo's availability |
| PR + CI for every change; no direct pushes | Reviewability and safety | Slower propagation than force-sync |
| Tool choice gated by POC, not assumed | Retrofit is the real risk | Up-front POC effort before committing |

---

## Open questions

1. **Generator choice** — confirmed only by the POC: Copier (file-centric, lower lock-in) vs Projen
   (code-as-config, higher lock-in). Leaning Copier for `create`.
2. **Fleet orchestration across two orgs** — how the central repo enumerates and opens PRs across
   both `ministryofjustice` and `CriminalInjuriesCompensationAuthority`: a GitHub App (cleanest for
   two orgs), `gh` + a PAT in Actions, or `multi-gitter`. The two-org scope pushes toward a GitHub App.
3. **Metadata filename** — `.project-baseline.yaml` is a working name; confirm before implementation.
4. **Merge strategy for `package.json`** — scripts/deps merge rules need precise definition in
   `file-policy.yaml` (especially reconciling `scripts` between legacy and reference-impl shapes).
5. **Package manager** — NPM today; the reference impl is NPM. PNPM was floated as possibly better.
   Deferred: keep NPM for the baseline unless a separate decision moves the estate to PNPM.
6. **MoJ Cloud Platform specifics** — the `node-service` deploy workflow and multi-stage Dockerfile
   need the actual Cloud Platform base image and `kube_deploy/` conventions pinned down.
```

