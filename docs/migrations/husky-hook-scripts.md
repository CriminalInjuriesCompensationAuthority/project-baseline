# Provisioning gap: husky hook scripts in `package.json`

Status: **partially provisioned.** This note records what the baseline now ships for git hooks, the
remaining gap, and the recommended way to close it.

## What the hooks need

The baseline ships two Husky hooks under `common/.husky/`:

- `pre-commit` → runs `npm run precommit`
- `pre-push` → runs `npm run prepush`

They are **thin wrappers**: the real behaviour lives in npm scripts in the consuming repo's
`package.json`. The reference implementation (`ministryofjustice/cica-review-case-documents`) defines:

```jsonc
"precommit:secrets": "command -v gitleaks >/dev/null 2>&1 || { echo 'gitleaks not found ...'; exit 1; }; gitleaks protect --staged --redact --verbose --config .gitleaks.toml",
"precommit:staged":  "node ./scripts/hooks/precommit-staged.js",
"precommit":         "npm run precommit:secrets && npm run precommit:staged",
"prepush:secrets":   "command -v gitleaks >/dev/null 2>&1 || { echo 'gitleaks not found ...'; exit 1; }; gitleaks detect --redact --verbose --config .gitleaks.toml",
"prepush":           "npm test && npm run lint:check && npm run audit:ci && npm run prepush:secrets"
```

and the helper `scripts/hooks/precommit-staged.js`.

## What the baseline now provisions

- `common/.husky/pre-commit`, `common/.husky/pre-push` — the hook files (already shipped).
- `common/scripts/hooks/precommit-staged.js` — the staged-file helper (added; provisioned via the
  `scripts/hooks/precommit-staged.js` entry in `policies/file-policy.yaml`, create/replace).

## The remaining gap: the `package.json` scripts

The `precommit` / `prepush` / `*:secrets` **scripts themselves are not provisioned.** `package.json`
is deliberately absent from `file-policy.yaml` because it is repo-specific (deps + app scripts) and
cannot be created or replaced wholesale. So after adoption today, a repo gets a `pre-commit` hook
that calls `npm run precommit`, **a script that may not exist** — the hook then errors on first use.

The file-policy model (whole-file `create`/`replace`/`merge`) has no strategy for **merging specific
keys into an existing JSON file**, which is what `package.json` scripts need.

### Recommended approach (needs a spec task)

Add a targeted `package.json` script-merge capability:

1. A new merge strategy, e.g. `json-scripts-merge`, in `policies/file-policy.yaml` for `package.json`,
   whose source is a small fragment listing the canonical hook scripts.
2. An implementation in `tooling/src/apply.js` that reads the target `package.json`, adds any missing
   hook scripts **without overwriting existing ones that differ** (report a conflict as `manual`
   instead), and preserves formatting / key order as much as practical.
3. Tests mirroring the existing merge-strategy tests (`apply.test.js`).
4. The scripts reference `npm run lint:check`, `npm run audit:ci`, and `npm test`, which the standard
   already assumes — so the merge only needs to add the hook-specific scripts, not the whole set.

Until that lands, adopting repos must add the hook scripts to `package.json` by hand (copy the block
above). The worked, verified reference is `cica-platform` (`packages`-root `package.json` +
`scripts/hooks/precommit-staged.js`), which implements exactly this setup.
