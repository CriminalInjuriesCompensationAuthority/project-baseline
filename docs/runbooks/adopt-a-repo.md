# Runbook: adopt a repo onto the baseline

Bring one repository in line with project-baseline and open a pull request for review. Works for an
existing repo and for a brand-new one (a new repo needs only a first commit, e.g. a `package.json`).

## Prerequisites

- Node `>=24.15.0` and, once: `cd tooling && npm install`.
- A local checkout of the target repo, on its **default branch**, with a GitHub `origin`.
- The GitHub CLI logged in (`gh auth status`) with push rights on the repo. `--push` uses your own
  login, so the PR and its commit are attributed to you.

## 1. Preview the plan (read-only)

```bash
node tooling/bin/baseline.js plan /path/to/repo --profile node-service   # or node-library
```

Each standard file is classified `create`, `replace`, `merge`, `manual` or `leave`. Read the
`replace` rows before going further: they overwrite the repo's version. For example, `biome.json` is
replaced with the stricter baseline config, which can change lint results.

## 2. Dry run

```bash
node tooling/bin/baseline.js apply /path/to/repo --profile node-service --push --dry-run
```

This builds the adoption branch on a throwaway clone and runs every safety check, but pushes
nothing. It ends with `Dry run: every check passed` or an `error:` saying exactly what to fix.

## 3. Open the PR

```bash
node tooling/bin/baseline.js apply /path/to/repo --profile node-service --push   # add --draft if preferred
```

It pushes `baseline/adopt-<version>` and opens a PR. The PR body lists:

- **Applied automatically**: each file and what was done (for `package.json`, which scripts were added).
- **Needs a human**: files deliberately left alone, with the reason for each.
- The diff stat.

The repo's CI runs on the PR. Nothing is merged automatically.

## 4. Review and merge

1. Read the diff and the "Needs a human" list.
2. Wait for CI.
3. Merge.
4. Then run `npm install` locally, so Husky installs the hooks.

Work through "Needs a human" items in follow-up PRs, using the guides in `docs/migrations/`.

## When it refuses

`--push` stops rather than guess. Nothing is pushed in any of these cases.

| Message | Fix |
| --- | --- |
| no `origin` remote / only supports GitHub remotes | Add the GitHub remote as `origin`. |
| uncommitted changes to tracked files | Commit or stash them (they would leak into merged files). |
| remote has no branch `<base>` | Push the default branch first, or check it out locally. |
| commit(s) that are not on the remote | Push or drop local commits; otherwise they would be published. |
| branch already exists on the remote but has no open PR | Delete or rename that branch, then retry. |
| `package.json`: prerequisites not met | Install husky 9 and Biome 2 first (e.g. the Husky 4 → 9 migration), then retry. |

If the push succeeds but opening the PR fails, the error says so and prints the exact
`gh pr create` command to finish by hand.

Re-running on a repo whose adoption PR is already open is safe. It reports the existing PR and opens
no duplicate.
