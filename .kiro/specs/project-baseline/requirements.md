# Requirements — Project Baseline

## Introduction

Project Baseline is a centrally managed engineering standards system for an organisation's Node.js
repositories on GitHub. It is the single source of truth for two related but distinct concerns:

1. **Dependency definitions** — which packages, at which approved versions, each type of repository
   should use.
2. **Shared files** — identically-named files (README scaffolding, `.editorconfig`, linter config,
   CI workflows, `.gitignore`, `tsconfig`, etc.) that should be consistent across repositories.

The system must serve three lifecycle scenarios from one source of truth:

- **Create** — bootstrap a brand-new repository with correct files, dependencies, and workflows.
- **Adopt** — retrofit an existing repository to the current standard without destroying its
  working configuration.
- **Maintain** — keep every repository (new or adopted) up to date as the central standards evolve.

Scope is limited to:

- **Repository types:** all repositories that serve a programmatic purpose — applications/services,
  shared libraries/helpers, and GitHub Actions. Pure documentation/content repositories are out of
  scope.
- **Ecosystem:** Node.js only. **Python repositories are explicitly out of scope** (the estate
  contains at least one, e.g. `cica-review-case-documents-airflow`); a Python profile is a possible
  future addition, not committed now. **Non-standard multi-tool repositories** with no root
  `package.json` (e.g. `q-dev-utilities`) are also out of scope until restructured.
- **Host:** GitHub, across **two organisations**: `ministryofjustice` and
  `CriminalInjuriesCompensationAuthority`.
- **Initial population:** approximately 20 existing repositories needing attention.

### Target standard (derived from the real estate)

The estate has a clear drift gradient. The newest repository, `cica-review-case-documents`, already
embodies the standard the organisation wants every repository to converge on, and is treated as the
**reference implementation** of the target baseline:

- **Node:** latest LTS (currently `>=24`).
- **Lint/format:** Biome (replacing the older ESLint + Prettier + airbnb-base setup).
- **Tests:** Node's built-in test runner with `c8` coverage (`c8 node --test`). Migrated via a
  dual-runner approach: existing Jest suites keep running while node:test suites are added alongside;
  no new Jest tests are added. node:test runs under CommonJS, so this does not depend on ESM.
- **Modules:** CommonJS is fully supported. ESM (`"type": "module"`) is **optional and deferred** —
  not required for compliance (see Requirement 12).
- **CI/CD:** GitHub Actions (replacing CircleCI — an active migration tracked as "Circle removed").
- **Dependencies:** Dependabot for automated update PRs.
- **Security:** `npm audit` gate plus gitleaks secret scanning.
- **Hooks:** Husky v9.
- **Common repo files (survey-derived):** `.npmrc` (`engine-strict=true`), `LICENSE` (MIT),
  `SECURITY.md`, and `AGENTS.md` are present across the estate and form part of the shared `common/`
  set. `AGENTS.md` is mandatory in every repo for conversational/agent consistency. `.dockerignore`
  is standard for services.

### Guiding principle: a baseline is a minimum, not a mandate

A "baseline" establishes the *minimum accepted standard*. It intentionally allows repositories to
differ where they have legitimate reasons to, provided they still meet the common standard. The
system must not force byte-for-byte identical configuration everywhere; doing so would cause teams
to work around it. Profiles exist to express different legitimate shapes of repository.

---

## Requirements

### Requirement 1 — Single source of truth

**User Story:** As an engineering lead, I want one central repository that defines all standards,
dependency version policies, and shared files, so that new and existing repositories are governed by
the same definitions rather than divergent mechanisms.

#### Acceptance Criteria

1. THE SYSTEM SHALL store all standard definitions (shared files, dependency version policies,
   workflow definitions, and profile definitions) in a single central repository named
   `project-baseline`.
2. THE SYSTEM SHALL version its standards such that any managed repository can reference a specific,
   identifiable version of the baseline it was generated from or last aligned to.
3. WHEN the central standards change THE SYSTEM SHALL use the same definitions to drive both
   new-repository creation and existing-repository maintenance.
4. THE SYSTEM SHALL NOT require a separate or divergent mechanism for new repositories versus adopted
   repositories.

### Requirement 2 — Standards profiles

**User Story:** As an engineering lead, I want a small set of approved repository profiles, so that
different legitimate kinds of repository (service, library, action) can share common standards while
differing where appropriate.

#### Acceptance Criteria

1. THE SYSTEM SHALL define a small set of named profiles covering at minimum: Node application/service,
   Node shared library, and GitHub Action.
2. THE SYSTEM SHALL provide a `legacy` profile representing a reduced, transitional standard for
   repositories not yet able to meet a current profile.
3. THE SYSTEM SHALL compose profiles from shared common definitions plus profile-specific overrides,
   so that near-identical files are not duplicated across profiles.
4. WHEN a repository declares a profile THE SYSTEM SHALL apply only the files, dependencies, and
   policies that the declared profile selects.
5. THE SYSTEM SHALL allow a repository to migrate from one profile to another (e.g. `legacy` →
   `node-api`) as an explicitly reviewed change.

### Requirement 3 — Create a new repository

**User Story:** As a developer starting a new project, I want to generate a repository that already
conforms to the baseline, so that it begins with the correct files, dependencies, versions, and
workflows.

#### Acceptance Criteria

1. WHEN a developer requests a new repository for a given profile THE SYSTEM SHALL generate a project
   containing the profile's standard files, dependency set at approved versions, and CI/CD workflows.
2. WHILE generating a new repository THE SYSTEM SHALL prompt for project-specific choices (at minimum:
   project name, profile/type, and deployment option) and apply them to the generated output.
3. THE SYSTEM SHALL record in the generated repository the baseline version and profile it was created
   from, in a form the maintenance process can later read.
4. WHERE repository provisioning is automated THE SYSTEM SHALL be able to apply the correct GitHub
   repository settings, rulesets, and permissions for the chosen profile.

### Requirement 4 — Adopt an existing repository

**User Story:** As a developer with an existing repository, I want to bring it into alignment with the
baseline without breaking its current working configuration, so that older projects can be modernised
safely and incrementally.

#### Acceptance Criteria

1. WHEN adoption is run against an existing repository THE SYSTEM SHALL first **inspect** it and
   determine which standards it already meets and which it does not.
2. THE SYSTEM SHALL produce a human-readable **adoption report** listing, per file and per policy,
   whether it would be created, replaced, merged, or left alone, and which items require manual review.
3. WHEN applying adoption changes THE SYSTEM SHALL make them on a separate Git branch and SHALL NOT
   modify the repository's default branch directly.
4. THE SYSTEM SHALL open a pull request that shows exactly what changed, so a human can review before
   merging.
5. THE SYSTEM SHALL NOT blindly overwrite existing files; WHERE a file already exists and differs it
   SHALL either merge, flag for manual review, or replace according to an explicit per-file policy.
6. WHERE a repository has no prior baseline metadata THE SYSTEM SHALL establish that metadata correctly
   as part of an explicit initial adoption step, rather than assuming the repository was previously
   generated from the template.
7. WHEN adoption completes THE SYSTEM SHALL run the repository's CI against the adoption branch so the
   proposed changes are validated before merge.

### Requirement 5 — Ongoing synchronisation

**User Story:** As an engineering lead, I want changes to the central standards to propagate to all
managed repositories, so that the whole estate stays aligned over time without manual effort.

#### Acceptance Criteria

1. WHEN the central standards change THE SYSTEM SHALL be able to generate update pull requests against
   every managed repository affected by the change.
2. THE SYSTEM SHALL target each repository's update using the repository's declared profile and
   recorded baseline version.
3. THE SYSTEM SHALL route synchronisation changes through pull requests and CI, never direct pushes to
   a default branch.
4. THE SYSTEM SHALL require human approval (via PR review) before synchronisation changes are merged.
5. THE SYSTEM SHALL produce equivalent update pull requests for a newly created repository and a
   retrospectively adopted repository when the same standard changes.

### Requirement 6 — Dependency management

**User Story:** As an engineering lead, I want approved dependency versions defined centrally and
enforced through automated update PRs, so that repositories converge on consistent, current versions.

#### Acceptance Criteria

1. THE SYSTEM SHALL define approved dependency version policies centrally, per profile where relevant
   (at minimum: a common Node LTS and shared `engines` floor).
2. THE SYSTEM SHALL use Dependabot as the automated dependency update mechanism, provisioning a
   standard `.github/dependabot.yml` onto managed repositories, including repositories not previously
   managed.
3. THE SYSTEM SHALL express the Dependabot configuration as a standard shared file kept in alignment
   via the synchronisation path, rather than hand-maintained divergently per repository.
4. WHEN a managed repository is missing or has an outdated Dependabot configuration THE SYSTEM SHALL
   raise a pull request to bring it into line (tracked as the "Dependabot updated" status).
5. THE SYSTEM SHALL keep dependency updates distinct from shared-file synchronisation, because the two
   have different safety characteristics (a dependency bump cannot be force-applied like a static file).

### Requirement 7 — Shared CI/CD logic

**User Story:** As an engineering lead, I want CI/CD logic defined once and reused, so that pipelines
are consistent and can be updated centrally.

#### Acceptance Criteria

1. THE SYSTEM SHALL define CI/CD logic as reusable GitHub Actions workflows held centrally.
2. THE SYSTEM SHALL enforce GitHub Actions as the sole CI/CD system; CircleCI is being phased out.
3. WHEN a managed repository runs CI THE SYSTEM SHALL have it reference the central reusable workflows
   rather than embedding a full private copy of the pipeline.
4. WHEN the central workflow changes THE SYSTEM SHALL propagate the change to referencing repositories
   via the standard synchronisation path.
5. WHEN adopting a repository that still uses CircleCI THE SYSTEM SHALL treat migration to GitHub
   Actions, and removal of the `.circleci/` configuration, as an explicit adoption step (tracked as
   "Circle removed"), flagged for manual review rather than auto-replaced.

### Requirement 8 — Governance and settings

**User Story:** As an engineering lead, I want repository-level governance (branch protection,
rulesets, permissions) expressed as part of the baseline, so that security and process controls are
consistent and auditable.

#### Acceptance Criteria

1. THE SYSTEM SHALL express repository governance settings (branch protection / rulesets, required
   checks, permissions) as part of the baseline definitions.
2. WHERE provisioning is automated THE SYSTEM SHALL apply the governance settings appropriate to a
   repository's profile.
3. THE SYSTEM SHALL treat governance settings as reviewable, versioned definitions rather than
   out-of-band manual configuration.

### Requirement 9 — Drift reporting

**User Story:** As an engineering lead, I want to see how far each repository deviates from its
baseline, so that I can prioritise and track the clean-up of the estate.

#### Acceptance Criteria

1. THE SYSTEM SHALL produce a compliance/drift report across managed repositories showing, per
   repository, its organisation, profile, recorded baseline version, and the standards it does and
   does not meet.
2. THE SYSTEM SHALL be able to report drift without modifying the inspected repositories.
3. THE SYSTEM SHALL present drift in a form that supports prioritising remediation across the estate.
4. THE SYSTEM SHALL produce the report in a form equivalent to the organisation's existing migration
   tracker, covering at least these per-repository status columns: Purpose, Implementation priority,
   Migrated, Circle removed, Repo Standards Applied, Migrated to Multi-stage Docker builds, Dependabot
   updated, and Deploy updated.
5. THE SYSTEM SHALL supersede the hand-maintained migration tracker spreadsheet by generating these
   statuses automatically from inspection of each repository.
6. THE SYSTEM SHALL provide a shared-file discovery report that computes a file-frequency matrix
   across all in-scope repositories and flags files present in a high proportion of repositories but
   absent from the baseline (candidate additions), so the baseline file set stays evidence-driven
   rather than hand-curated from a sample.
7. THE SYSTEM SHALL provide a dependency-hygiene report across in-scope repositories that flags, at
   minimum: dependencies referenced but not declared (including literal `node_modules/<pkg>` paths),
   dependencies declared but unused, the same dependency at divergent versions across repositories,
   and literal references into transitive dependencies. THE SYSTEM SHALL treat hygiene findings as
   advisory inputs to adoption/sync (surfaced as reviewed PRs), never force-applied.

### Requirement 10 — Proof of concept gate

**User Story:** As an engineering lead, I want the core concept validated end-to-end before committing
to a tool and building out the full system, so that we do not invest in an approach that cannot handle
safe retrofit.

#### Acceptance Criteria

1. THE SYSTEM SHALL be validated by a proof of concept demonstrating one complete lifecycle: create a
   new repository, retrospectively adopt an existing repository, then change a central standard and
   show that both repositories receive equivalent update pull requests.
2. THE proof of concept SHALL use at least one real existing CICA repository as an adoption target
   (e.g. `cica-apply-data-capture-service`, which is still on CircleCI, Jest, and ESLint+Prettier).
3. THE tooling decision (e.g. Copier vs Projen vs alternatives) SHALL be evaluated explicitly against
   the retrofit requirement (Requirement 4), not assumed in advance.
4. IF the proof of concept cannot reliably perform safe retrofit THEN the tooling choice SHALL be
   reconsidered before further build-out.
5. THE SYSTEM SHALL treat `cica-review-case-documents` as the reference implementation of the target
   standard that other repositories converge toward.

### Requirement 11 — Security and audit

**User Story:** As an engineering lead, I want dependency vulnerability auditing and secret scanning
built into the baseline, so that security checks are consistent and enforced across every repository.

#### Acceptance Criteria

1. THE SYSTEM SHALL define a standard `npm audit` gate (`npm audit --audit-level=high --omit=dev`) and
   include it as a required CI check.
2. THE SYSTEM SHALL provision gitleaks secret scanning (configuration plus pre-commit/pre-push and CI
   checks) as part of the baseline.
3. THE SYSTEM SHALL provision Dependabot for automated dependency-vulnerability and update PRs
   (per Requirement 6).
4. THE SYSTEM SHALL keep the audit severity threshold configurable centrally, defaulting to failing
   on `high` and above.
5. WHEN a managed repository lacks a required security check THE SYSTEM SHALL report it as drift and
   be able to raise a pull request to add it.

### Requirement 12 — Migration coexistence and optional ESM

**User Story:** As a maintainer of a working legacy service, I want invasive migrations to proceed
incrementally without breaking the build, and I want ESM to be optional, so that adoption never
forces a risky big-bang change.

#### Acceptance Criteria

1. WHEN migrating a repository from Jest to the Node test runner THE SYSTEM SHALL support both
   runners coexisting: the existing Jest suites keep running while node:test suites are added in
   parallel, so CI stays green throughout.
2. THE SYSTEM SHALL preserve the existing Jest environment setup and coverage thresholds during the
   transition, porting them to `.env.test` and `.c8rc.json` rather than discarding them.
3. THE SYSTEM SHALL NOT require ESM (`"type": "module"`) for any profile; a repository MAY remain
   CommonJS and still be fully compliant.
4. THE SYSTEM SHALL treat the CommonJS → ESM migration as optional, decoupled from the test-runner
   migration, and SHALL NOT report CommonJS as drift or as a failed standard.
5. THE SYSTEM SHALL document each invasive migration (test runner, lint tooling, CI, hooks, security,
   and the optional ESM move) as a guided, human-driven step.
```

