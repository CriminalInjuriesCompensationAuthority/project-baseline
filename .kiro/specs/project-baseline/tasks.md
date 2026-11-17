# Tasks — Project Baseline

Implementation plan. Sequenced so the **proof-of-concept gate (Phase 2)** is reached early, before
heavy build-out. Each task notes the requirements it satisfies. Do not proceed past the Phase 2 gate
until the POC succeeds.

**Target standard** is the reference implementation `cica-review-case-documents`: Node LTS (`>=24`),
Biome, node:test + c8, ESM, Husky v9, GitHub Actions, Dependabot, `npm audit` gate + gitleaks.
**Scope:** two GitHub orgs — `ministryofjustice` and `CriminalInjuriesCompensationAuthority`.

> **Status key (last verified 2026-11-11).** `[x]` = built and verified. `[ ]` = not done.
> A `Status:` line under an unticked task records what already exists and what is missing, so a
> `[ ]` with a `Partial` note is partly built rather than untouched.

---

## Phase 0 — Foundations

- [x] 1. Scaffold the central `project-baseline` repository structure
  - Create `common/`, `profiles/`, `policies/`, `workflows/`, `dependabot/`, `security/`, `tooling/`.
  - Add `baseline.config.yaml` with an initial version (e.g. `0.1.0`), an empty profile registry, and
    the two-org list.
  - Add a top-level README describing the three lifecycle operations (create/adopt/maintain).
  - _Requirements: 1.1, 1.2_
  - Status: done, with two deliberate deviations: reusable CI lives in `.github/workflows/`
    (not a top-level `workflows/`), and security config is `policies/security.yaml` +
    `common/.gitleaks.toml` (not a top-level `security/`).

- [ ] 2. Define the baseline metadata contract
  - Specify the `.project-baseline.yaml` schema (`baselineVersion`, `profile`, `org`, `adoptedAt`,
    `managed`) and document it.
  - Write a small validator that reads/validates the metadata file.
  - _Requirements: 1.2, 3.3, 4.6_
  - Status: **Partial.** Schema is documented (`docs/metadata.md`) and `apply` writes the file.
    **No validator exists yet.**

- [x] 3. Author `policies/file-policy.yaml`
  - Enumerate each standard file and its adopt behaviour: `create | replace | merge | manual | leave`.
  - Classify invasive migrations (Jest→node:test, CommonJS→ESM, CircleCI→GHA, multi-stage Docker) as
    `manual`; mechanical files (Dependabot config, gitleaks, editorconfig) as `create`/`replace`.
  - Define the `package.json` (scripts/deps) and `.gitignore` merge rules explicitly.
  - _Requirements: 4.2, 4.5, 7.5_
  - Status: done. `package.json` **scripts** are merged by name via the `json-scripts` strategy
    (prerequisite-gated; see `docs/migrations/husky-hook-scripts.md`). **Dependencies are
    deliberately not merged**: `apply` runs no `npm install`, so a changed manifest would leave the
    lockfile stale and break `npm ci`.

---

## Phase 1 — One profile, end to end (pre-POC build)

Extract real content from `cica-review-case-documents` as the canonical source for these files.

- [ ] 4. Build the `common/` shared file set
  - Add `.editorconfig`, `.gitignore`, `.gitattributes`, `biome.json`, `.c8rc.json`,
    Husky v9 hooks, and `README.scaffold.md`.
  - _Requirements: 2.3_
  - Status: **Partial.** Everything listed exists (plus `.npmrc`, `LICENSE`, `SECURITY.md`,
    `AGENTS.md`, `.gitleaks.toml`, CODEOWNERS, the staged-hook helper and the hook-scripts
    fragment) **except `README.scaffold.md`**.

- [ ] 5. Build the `node-service` profile
  - Multi-stage `Dockerfile` using the MoJ Cloud Platform base image, `kube_deploy/` scaffold,
    ESM `"type": "module"`, node:test + c8 test setup.
  - Register it in `baseline.config.yaml`.
  - _Requirements: 2.1, 2.4_
  - Status: **Partial.** Registered; multi-stage `Dockerfile`, `.dockerignore`, workflows and an
    `app.js` / `bin/www` scaffold exist. **No `kube_deploy/` scaffold.**

- [ ] 6. Add the reusable CI workflow (GitHub Actions)
  - Author `workflows/ci.yml` as a reusable workflow: Biome check, node:test + c8, `npm audit` gate,
    gitleaks scan, build.
  - Add a thin caller workflow template to the `node-service` profile referencing it.
  - _Requirements: 7.1, 7.2, 7.3, 11.1_
  - Status: **Partial.** `.github/workflows/node-ci.yml` runs Biome, node:test + c8 and the
    `npm audit` gate, with a shared thin caller (`profiles/_shared/ci-caller.yml`). **It does not
    run a gitleaks scan or a build step.** (gitleaks runs in the Husky hooks and the profile
    `tests.yml`.)

- [x] 7. Add the standard Dependabot config and version policy
  - Author `dependabot/default.yml` and `policies/versions.json` (Node LTS, `engines` floor).
  - Include the `dependabot.yml` in the `node-service` profile as a provisioned file.
  - _Requirements: 6.1, 6.2, 6.3_

- [x] 8. Add the security baseline
  - Author `security/gitleaks.toml` and `policies/security.yaml` (audit level default `high`).
  - Wire `audit:ci` script + gitleaks into the profile's scripts and Husky hooks.
  - _Requirements: 11.1, 11.2, 11.4_
  - Status: done. `audit:ci`, `precommit:secrets` and `prepush:secrets` are provisioned into
    `package.json` (prerequisite-gated) and called from the Husky hooks.

---

## Phase 2 — PROOF OF CONCEPT GATE (Req 10) 🚧

> Do not build further profiles or fleet automation until this phase passes.

- [ ] 9. Select and wire the generator for `create`
  - Evaluate Copier vs Projen against the retrofit requirement; record the decision and rationale.
  - Implement `create` for the `node-service` profile (prompts: name, profile, org, deployment option).
  - Write `.project-baseline.yaml` into the generated output.
  - _Requirements: 3.1, 3.2, 3.3, 10.3_
  - Status: **Not started.** No generator decision and no `create` command. In practice
    `baseline apply` already scaffolds an empty repo, so this is polish rather than a blocker.

- [x] 10. Implement the adoption layer — Inspect + Plan
  - `inspect`: read-only comparison of a target repo against its profile and the reference impl.
  - `plan`: emit the adoption report classifying each item (create/replace/merge/manual/leave),
    including the tracker-aligned statuses (Circle removed, Dependabot updated, etc.).
  - _Requirements: 4.1, 4.2, 9.2, 9.4_

- [x] 11. Implement the adoption layer — Apply + Validate
  - `apply`: write changes to a `baseline/adopt-<version>` branch only; write metadata; leave `manual`
    items untouched and list them in the PR body.
  - `validate`: push branch, open PR with the report embedded, trigger CI.
  - _Requirements: 4.3, 4.4, 4.5, 4.6, 4.7_
  - Status: done, as `baseline apply --push` (`tooling/src/publish.js`), with `--dry-run` and
    `--draft`. It pushes the branch, opens a PR whose body lists what was applied, what was left for a
    human (with reasons) and the diff stat, and CI then runs on the PR. Verified end to end against
    `project-baseline-sandbox` (PR #1: CI green; a second run reports the existing PR rather than
    duplicating). It runs with the operator's own `gh` login; unattended fleet auth (GitHub App vs
    PAT) is a decision for `sync` (task 13), not this task. Safety rails: never force-pushes, refuses
    on a non-GitHub origin, uncommitted tracked changes, a missing remote base branch, unpushed local
    commits, or an existing remote branch without a PR.

- [ ] 12. Run the full POC cycle against real repos
  - Create a new `node-service` repo.
  - Adopt `cica-apply-data-capture-service` (real, CircleCI/Jest/ESLint) toward the reference impl.
  - Change a central standard; show both repos receive **equivalent** update PRs.
  - Record results; if safe retrofit fails, revisit the generator choice before continuing.
  - _Requirements: 10.1, 10.2, 10.4, 10.5, 5.5_
  - Status: **Partial.** Done so far:
    - a new repo (`project-baseline-sandbox`) was adopted end to end with `apply --push`, and its CI
      and hooks work (see task 11);
    - an adoption report exists for `cica-apply-data-capture-service` (`docs/adoption-reports/`);
    - `apply` has been run on `cica-logger` and `cica-apply-web` (throwaway clones, sources
      untouched).

    **Not yet done:**
    - the sandbox was a `node-library` repo, not `node-service`;
    - `cica-apply-data-capture-service` has not had `--push` run against it;
    - no "change a central standard, both repos receive equivalent PRs" cycle was run, since that
      needs `sync` (task 14).

---

## Phase 3 — Synchronisation at fleet scale (two orgs)

- [ ] 13. Decide and implement fleet orchestration
  - Choose the mechanism (GitHub App preferred for two-org access, vs `gh`+PAT or `multi-gitter`);
    record the decision.
  - Implement managed-repo enumeration across both `ministryofjustice` and
    `CriminalInjuriesCompensationAuthority` (repos with `managed: true`).
  - _Requirements: 5.1_
  - Status: **Not started.** Local-estate enumeration exists (`estate.js`); GitHub-side does not.

- [ ] 14. Implement the sync engine
  - For each managed repo: read `org`+`profile`+`baselineVersion`, compute delta, open
    `baseline/sync-<version>` PR, bump metadata, trigger CI.
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_
  - Status: **Not started.** Depends on 11 (`validate`) and 13.

- [ ] 15. Onboard Dependabot across the estate
  - Provision/align `.github/dependabot.yml` on existing repos (including previously unmanaged ones)
    via sync PRs; migrate Snyk-based repos onto the standard.
  - _Requirements: 6.2, 6.4, 6.5_
  - Status: **Not started** (the file is provisioned by `apply`; estate rollout needs 14).

---

## Phase 4 — Remaining profiles

- [x] 16. Build the `node-library` profile
  - Library files + npm/git-tag release workflow; `main`/`exports`; build step; no Dockerfile.
  - Register in config; add version policy entry. Targets e.g. `q-router`, `q-templates-application`.
  - _Requirements: 2.1, 2.3, 2.4_
  - Status: done. The release workflow tags + creates a GitHub Release, with **opt-in** npm publish
    (only when `NPM_TOKEN` is set; see `docs/migrations/library-release-npm-publish.md`).

- [ ] 17. Build the `github-action` profile
  - `action.yml` scaffold + action build/release workflow; register in config.
  - _Requirements: 2.1, 2.3, 2.4_
  - Status: **Not started** (listed as planned; no `profiles/github-action/`).

- [ ] 18. Build the `legacy` profile and profile migration
  - Reduced transitional standard: lint/test/CI + security baseline only; keeps Jest/ESLint until
    migrated.
  - Implement explicit, reviewed profile migration (`legacy` → current profile).
  - _Requirements: 2.2, 2.5_
  - Status: **Not started** (listed as planned; no `profiles/legacy/`).

---

## Phase 5 — Governance, audit, rollout

- [ ] 19. Implement governance settings
  - Author `policies/governance.yaml` (rulesets, required checks incl. Biome/test/audit/gitleaks,
    permissions) per profile, per org.
  - Apply at create time; reconcile during sync.
  - _Requirements: 3.4, 8.1, 8.2, 8.3_
  - Status: **Not started** (no `policies/governance.yaml`).

- [x] 20. Implement the audit / drift report (replaces the tracker spreadsheet)
  - Reuse `inspect` across all managed repos (read-only); emit the tracker-shaped per-repo table
    (Migrated, Circle removed, Repo Standards Applied, Multi-stage Docker builds, Dependabot updated,
    Deploy updated) plus an aggregate roll-up.
  - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

- [ ] 21. Roll out across the existing repositories (both orgs)
  - Adopt each tracked repo onto `legacy` or a current profile, prioritised by the tracker's
    Implementation priority (High first).
  - Drive the required migrations (Husky v9, Snyk→baseline, CircleCI→GHA "Circle removed",
    ESLint→Biome, Jest→node:test dual-runner) as reviewed PRs; migrate `legacy` repos onto current
    profiles. (ESM is deferred/optional — not part of rollout.)
  - Track progress via the generated drift report.
  - _Requirements: 4.*, 5.*, 7.5, 9.*_
  - Status: **Not started.** `baseline audit` reports every in-scope repo as in progress, none
    migrated.

- [x] 22. Implement shared-file discovery (keep the baseline evidence-driven)
  - Compute a file-frequency matrix across all in-scope repos (local now; full GitHub estate via the
    sync fleet-enumeration later). Read-only.
  - Flag candidate baseline additions (high-frequency files absent from `common/`/profiles) and
    unexpected divergence (baselined files overridden without a declared `override`).
  - Run before each baseline version bump so the file set is never a hand-curated guess from a
    sample. (This is how `.npmrc`/`LICENSE`/`SECURITY.md`/`AGENTS.md` gaps were caught.)
  - _Requirements: 9.6_

- [x] 23. Implement dependency-hygiene check (sibling of shared-file discovery)
  - Scan `package.json` + lockfile + source across in-scope repos (read-only) for: undeclared-but-
    referenced deps (incl. literal `node_modules/<pkg>` paths), declared-but-unused deps, cross-repo
    version skew, and transitive-path reaches.
  - Emit an advisory report feeding adoption/sync as reviewed PRs (never force-applied).
  - (This is how the govuk-frontend transitive-path + @ministryofjustice/frontend version skew were
    caught.)
  - _Requirements: 9.7_
