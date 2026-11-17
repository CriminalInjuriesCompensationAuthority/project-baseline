# Husky hook scripts in `package.json`

Status: **provisioned** (via the `json-scripts` merge strategy). This note explains what the baseline
ships for git hooks, how the `package.json` scripts are added safely, and the known limits.

## How the hooks fit together

The baseline ships two Husky hooks under `common/.husky/`:

- `pre-commit` → runs `npm run precommit`
- `pre-push` → runs `npm run prepush`

They are **thin wrappers**: the behaviour lives in npm scripts in the repo's `package.json`, plus a
helper script. The reference implementation (`ministryofjustice/cica-review-case-documents`) and
`cica-platform` both use this shape:

| Hook | Runs | Which does |
| --- | --- | --- |
| `pre-commit` | `precommit` | `precommit:secrets` (gitleaks on **staged** changes) then `precommit:staged` |
| `pre-push` | `prepush` | `npm test`, `lint:check`, `audit:ci`, `prepush:secrets` (gitleaks on full history) |

`precommit:staged` runs `scripts/hooks/precommit-staged.js`, which works on staged files only: it
**aborts if a staged file also has unstaged changes**, runs Biome `check --write` on staged
`.js`/`.json` (skipping `package-lock.json`), re-stages the fixes, then runs the tests. Both
`*:secrets` scripts **fail loudly if gitleaks is not installed** rather than silently skipping.

## What the baseline provisions

| Artifact | How |
| --- | --- |
| `.husky/pre-commit`, `.husky/pre-push` | `common/.husky/*` (create / replace) |
| `scripts/hooks/precommit-staged.js` | `common/scripts/hooks/precommit-staged.js` (create / replace) |
| the npm scripts | `common/package-scripts.json` merged into `package.json` (`json-scripts`) |

The scripts provisioned are: `lint`, `lint:check`, `lint:fix`, `format`, `audit:ci`,
`precommit:secrets`, `precommit:staged`, `precommit`, `prepush:secrets`, `prepush`, `prepare`. The
lint/format/audit ones are included because the hooks, the central CI workflow
(`npm run lint`, `npm run audit:ci`) and `AGENTS.md` all call them; a test
(`tooling/src/templates.test.js`) fails if any of those callers references a script the fragment
does not provide.

## The `json-scripts` merge strategy

`package.json` is repo-specific, so it is never created or replaced wholesale. The `json-scripts`
strategy (`tooling/src/packageScripts.js`) only ensures the scripts above **exist**:

- Matching is by script **name**. An existing script is **never overwritten**, because values are
  legitimately repo-specific (each repo's `prepush` composes its own steps).
- Existing keys keep their order; additions are appended after them.
- Indent style and trailing newline are preserved; every other key is untouched.
- `package.json` is never created if absent (`whenAbsent: manual`).
- Invalid JSON, or a non-object `scripts`, is demoted to **manual**.

### Prerequisites (the merge refuses without them)

The scripts only work if their tooling is installed, so the merge is **gated** on
`policies/file-policy.yaml` → `requiresDevDependencies`:

- `husky` major **>= 9**: `prepare: husky` makes `npm install` **fail** if husky is absent or is v4
  (v4 has no `husky` binary).
- `@biomejs/biome` major **>= 2**: `precommit:staged` calls `biome`.

If either is unmet, `package.json` is demoted to manual and the `apply` report says why, e.g.
`husky "^4.3.8" does not satisfy major >= 9; @biomejs/biome (major >= 2) is not a dependency`. The
baseline deliberately does **not** add the dependencies itself: `apply` runs no `npm install`, so the
lockfile would go stale and break `npm ci`. Do the Husky 4 → 9 migration
(`docs/migrations/`) first, then re-run `apply`.

## Known limits

- **An existing `prepush` is kept as-is.** A repo whose `prepush` lacks `prepush:secrets` (for
  example `cica-logger` at the time of writing) keeps it, so the full-history secret scan will not run
  on push until the line is added by hand. This is the trade-off of never overwriting repo-specific
  values; add `&& npm run prepush:secrets` to adopt the standard.
- **`test` is not provisioned.** It is repo-specific (`c8 node --test`, `jest`, ...); `prepush` and
  `precommit:staged` both call `npm test`, so the repo must define it.
- **`plan` is advisory for this file.** `plan` shows `merge` whenever scripts are missing; whether
  prerequisites are met is only evaluated by `apply`, which reports the demotion.
- On a repo that is still on Husky 4, `apply` still creates `.husky/*` and the helper. They are inert
  until Husky 9 is installed, so this is harmless.
- The merge rewrites `package.json` using `JSON.stringify` with the detected indent (the same style
  npm writes), so unusual hand-formatting, such as inline arrays, may be normalised.

## Reference implementation

`cica-platform` (root `package.json` + `scripts/hooks/precommit-staged.js`) is byte-identical to the
baseline: `baseline plan` reports every hook file and `package.json` as `leave`.
