# Project Baseline

A centrally managed engineering standard for CICA's Node.js repositories, plus the tooling to
**create, align, and maintain** repositories against it — across the `ministryofjustice` and
`CriminalInjuriesCompensationAuthority` GitHub organisations.

> **In one sentence:** this repo defines what a "good" CICA Node repo looks like, and ships a CLI that
> can inspect any repo against that standard and align it.

---

## The problem it solves

CICA has ~20 Node.js repositories (apps, libraries, GitHub Actions). They share many of the same
files (linter config, CI, `.gitignore`, security policy…) and the same dependencies — but at
different versions and with drift between them. Keeping them consistent by hand does not scale.

Project Baseline is the **single source of truth** for:

1. **Shared files** — the config/scaffolding every repo should have.
2. **Dependency + version policy** — approved versions and how updates flow.
3. **Shared runtime behaviour** — distributed as versioned libraries, not copied code.

It supports three lifecycles from that one source: **create** a new repo, **adopt** (retrofit) an
existing one, and **maintain** them all as the standard evolves.

---

## What's in this repo

```
project-baseline/
├── baseline.config.yaml     # top-level config: version, orgs, profiles, shared-library registry
├── common/                  # files EVERY repo gets (biome.json, .editorconfig, .gitignore,
│                            #   .husky/, .gitleaks.toml, .npmrc, LICENSE, SECURITY.md, AGENTS.md,
│                            #   .github/CODEOWNERS, .c8rc.json, .gitattributes)
├── profiles/                # per-repo-type additions on top of common/
│   ├── node-service/        #   deployable app/service (Dockerfile, CI workflows, app.js scaffold)
│   └── node-library/        #   publishable library (release workflow, no Dockerfile)
├── policies/
│   ├── file-policy.yaml     # how adoption treats each file: create|replace|merge|manual|leave
│   ├── versions.json        # approved Node/toolchain/frontend versions
│   └── security.yaml        # npm audit level, gitleaks, dependabot
├── dependabot/              # standard Dependabot config
├── tooling/                 # the CLI (see below) — Node package
├── docs/                    # metadata contract, migration guides, shared-library design,
│                            #   generated reports
└── .kiro/specs/             # the requirements / design / tasks spec
```

### Profiles (a "baseline" is a minimum, not a straitjacket)

Different kinds of repo legitimately differ, so the standard is expressed as **profiles**:

| Profile | For | Status |
| --- | --- | --- |
| `node-service` | deployable apps/services | active |
| `node-library` | publishable libraries | active |
| `github-action` | GitHub Action repos | planned |
| `legacy` | reduced transitional standard for old repos | planned |

The **reference implementation** is `ministryofjustice/cica-review-case-documents` — the newest repo,
which already embodies the target standard (Biome, node:test, ESM, Husky v9, GitHub Actions,
Dependabot, gitleaks).

---

## The CLI (`tooling/`)

A Node CLI (`baseline`) that operates on repositories. **All commands below are read-only except
`apply`, which only writes to a throwaway clone — never your working repo.**

```
baseline inspect  <repoPath> --profile <name>   What state is each standard file in?
baseline plan     <repoPath> --profile <name>   What would change to align this repo?
baseline apply    <repoPath> --profile <name>   Align a repo (on a clone + branch, committed locally)
baseline audit    <parentDir>                    Estate-wide tracker table (replaces the spreadsheet)
baseline discover <parentDir>                    Which shared files are we missing from the baseline?
baseline deps     <parentDir>                    Dependency hygiene (undeclared/unused/skew/transitive)
```

### Run it

```bash
cd tooling
npm install
node bin/baseline.js audit /var/dev          # see the whole local estate
node bin/baseline.js plan  /var/dev/some-repo  # preview aligning one repo
node bin/baseline.js apply /var/dev/some-repo  # align it (safe: clone only)
```

### What `apply` actually does (the "inject + align" capability)

1. Clones the target repo to a temp dir (never touches your working copy, no network).
2. Applies the **safe, automatic** changes (create/replace/merge) with placeholder substitution.
3. Writes `.project-baseline.yaml` (the metadata that marks the repo as managed).
4. Commits them to a `baseline/adopt-<version>` branch.
5. Leaves **risky, behaviour-changing** migrations (Jest→node:test, CircleCI→GitHub Actions,
   ESLint→Biome, Dockerfile) flagged for a human, with links to the migration guides.

It **stops before pushing** — push + pull-request creation need GitHub auth and are intentionally not
built yet.

---

## Shared runtime libraries

Behaviour that should be consistent across services (logging, security headers, error handling) is
distributed as **versioned libraries repos depend on**, *not* copied into each `app.js`. See
`docs/shared-libraries.md` for the full rationale.

All three live together in the `cica-platform` npm-workspaces monorepo (`../cica-platform`), each a
standalone, independently-versioned `@cica/*` package consumers import individually.

| Library | Provides | Status |
| --- | --- | --- |
| `@cica/logger` | pino logger factory with env-driven redaction + correlation id | **built** (`cica-platform/packages/logger`) |
| `@cica/express-baseline` | helmet/CSP, security headers, env validation, error handlers, health | **built** (`cica-platform/packages/express-baseline`) |
| `@cica/nunjucks-govuk` | nunjucks + GOV.UK/MoJ asset resolution (web apps only) | **built** (`cica-platform/packages/nunjucks-govuk`) |

---

## Current status (honest)

**Working and tested today:**
- The standard itself — `common/` + `node-service`/`node-library` profiles + policies.
- The CLI: `inspect`, `plan`, `audit`, `discover`, `deps`, and local `apply` (72 tests, lint clean).
- All three shared libraries: `@cica/logger` (27 tests), `@cica/express-baseline` (19 tests),
  `@cica/nunjucks-govuk` (10 tests) — each lint clean.
- Proven against the real `cica-apply-data-capture-service` and the local estate.

**Not yet built (and why):**
- **Push + PR creation** — needs GitHub credentials + an auth decision (GitHub App vs token).
- **`sync`** (propagate standard changes to all repos) — needs fleet orchestration / auth.
- **`create`** (polished new-repo generator) — needs a Copier-vs-Projen decision; `apply` + profiles
  already cover most of it.
- **Reaching the ~13 GitHub-only repos** — needs GitHub access (only 7 are available locally).
- **Git repos + CI not yet wired** — the libraries and tooling are directories, not committed repos.

---

## Scope

- **In scope:** Node.js repos that serve a programmatic purpose (apps, libraries, GitHub Actions),
  on GitHub, across the two CICA orgs.
- **Out of scope (recorded):** Python repos (e.g. `cica-review-case-documents-airflow`) and
  non-standard multi-tool repos without a root `package.json` (e.g. `q-dev-utilities`).

---

## Where to read more

- `.kiro/specs/project-baseline/` — requirements, design, and task breakdown.
- `docs/shared-libraries.md` — why runtime behaviour is libraries, not templates.
- `docs/migrations/` — step-by-step guides for the human-driven migrations.
- `docs/metadata.md` — the `.project-baseline.yaml` contract that marks a repo as managed.
```

