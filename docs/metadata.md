# Baseline metadata contract — `.project-baseline.yaml`

Every repository managed by project-baseline carries one metadata file at its root:
`.project-baseline.yaml`. This file is what lets `create` and `adopt` share a single maintenance
path: the `sync` and `audit` operations read it to know which profile governs a repo and which
baseline version it was last aligned to.

## Schema

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `baselineVersion` | string (semver) | yes | The `baselineVersion` from `baseline.config.yaml` the repo was created from or last aligned to. |
| `profile` | string | yes | Registered profile name: `node-service`, `node-library`, `github-action`, or `legacy`. |
| `org` | string | yes | GitHub org: `ministryofjustice` or `CriminalInjuriesCompensationAuthority`. |
| `adoptedAt` | string (date) | yes | ISO date the repo was first created/adopted (`YYYY-MM-DD`). |
| `managed` | boolean | yes | Opt-in flag. `sync`/`audit` only act on repos where this is `true`. |
| `overrides` | string[] | no | Paths deliberately diverging from the baseline; `sync` leaves these alone. |

## Example

```yaml
baselineVersion: 0.1.0
profile: node-service
org: ministryofjustice
adoptedAt: 2026-11-02
managed: true
overrides:
  - .gitignore   # repo has legitimate extra build-artifact entries
```

## Rules

- A repo with no `.project-baseline.yaml` is **unmanaged**. Adoption establishes this file explicitly
  as part of the first adoption; it is never backfilled to pretend prior management.
- `profile` must exist in `baseline.config.yaml` with `status: active` before `sync` will act on it.
- `baselineVersion` is bumped by `sync`/`adopt` when changes for a new baseline version are merged.
- `overrides` is the mechanism that keeps the baseline a *minimum, not a mandate*: a repo can
  legitimately differ on listed paths without being reported as drift.

## Validation

A validator checks that: the file parses, all required fields are present, `profile` is registered,
`org` is in the configured list, and `baselineVersion` is valid semver. It is run during `adopt`
(before writing) and `audit` (when reading).
