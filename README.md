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
`apply`, which only writes to a throwaway clone — never your working repo — and, only with
`--push`, pushes a branch and opens a PR.**

```
baseline inspect  <repoPath> --profile <name>   What state is each standard file in?
baseline plan     <repoPath> --profile <name>   What would change to align this repo?
baseline apply    <repoPath> --profile <name>   Align a repo (on a clone + branch, committed locally)
                  [--push [--dry-run] [--draft]] ...and push the branch + open a PR
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

By default it **stops before pushing**. Add `--push` to also:

6. Push the `baseline/adopt-<version>` branch to the repo's GitHub `origin` (never forced).
7. Open a pull request listing what was applied, what was left for a human (with reasons), and the
   diff stat. The repo's CI then runs on the PR. Nothing is merged automatically.

`--push` uses your own `gh` login and refuses rather than guess: on a non-GitHub origin, uncommitted
changes to tracked files, a remote without the base branch, local commits that are not on the
remote, or an existing remote branch with no PR. Re-running it reports the existing PR instead of
opening a duplicate. Use `--dry-run` to run every check without pushing, and `--draft` for a draft
PR. Step by step: `docs/runbooks/adopt-a-repo.md`.

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

## Releasing the baseline: the `v1` CI ref

Every adopted repo's `.github/workflows/ci.yml` is a thin caller of this repo's reusable workflow,
pinned by tag:

```yaml
uses: CriminalInjuriesCompensationAuthority/project-baseline/.github/workflows/node-ci.yml@v1
```

So **the `v1` tag must exist and must point at a commit where `node-ci.yml` works** — if it is
missing, every consumer's CI fails with "workflow file issue" (this happened once: `cica-platform`
failed on every push until the tag was created). `v1` is a *moving* major tag, with `v1.0.0` as the
immutable marker for the first release.

- **Backwards-compatible change** to `node-ci.yml` (same inputs, same scripts called): get CI green
  on `main`, then move the tag so all consumers pick it up:
  ```bash
  git tag -fa v1 -m "project-baseline v1" <sha> && git push --force origin v1
  git tag -a v1.x.y -m "project-baseline v1.x.y" <sha> && git push origin v1.x.y
  ```
- **Breaking change** (renamed input, a new script every repo must define): cut `v2` and bump
  consumers through `baseline apply` / sync; leave `v1` where it is.
- Consumers run whatever `v1` points at, so only tag a commit whose CI is green.

---

## Current status (honest)

**Working and tested today:**
- The standard itself — `common/` + `node-service`/`node-library` profiles + policies.
- The CLI: `inspect`, `plan`, `audit`, `discover`, `deps`, and `apply`, including `apply --push`
  (pushes the branch and opens the PR) (148 tests, lint clean, CI green on `main`).
- The Husky hooks work end to end: `apply` provisions the hook files, the staged-file helper, **and**
  the `precommit`/`prepush` npm scripts they call (a prerequisite-gated `package.json` merge; it
  refuses rather than break a repo still on Husky 4 or without Biome). See
  `docs/migrations/husky-hook-scripts.md`.
- The `node-library` release workflow: tag + GitHub Release, with **opt-in** npm publish (only when
  the `NPM_TOKEN` secret is set).
- All three shared libraries live in the `cica-platform` monorepo and are tested and lint clean.
- Proven end to end on a real GitHub repo: `apply --push` adopted `project-baseline-sandbox` and
  opened a PR whose CI passed. In a fresh clone of that branch:
  - `npm ci` installed Husky;
  - the pre-commit hook auto-formatted a file, rejected a partially staged one and blocked a staged
    private key;
  - the pre-push gate passed.
- `apply` has also been run on `cica-logger` and `cica-apply-web` (throwaway clones; the source
  repos are never touched), and an adoption report exists for `cica-apply-data-capture-service`.

**Not yet built (and why):**
- **`sync`** (propagate standard changes to all repos) — needs fleet orchestration, plus an auth
  decision for running unattended across repos (GitHub App vs token). `apply --push` deliberately
  uses the operator's own `gh` login, one repo at a time.
- **`create`** (polished new-repo generator) — needs a Copier-vs-Projen decision; `apply` + profiles
  already cover most of it.
- **`github-action` and `legacy` profiles, and governance settings** — not started.
- **Reaching the ~13 GitHub-only repos** — needs GitHub access (only 7 are available locally).

Per-task status (what is done, partial or not started) is tracked in
`.kiro/specs/project-baseline/tasks.md`.

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

