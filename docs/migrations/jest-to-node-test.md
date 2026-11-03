# Migration: Jest → Node test runner (`node:test` + c8)

**Strategy:** dual-runner coexistence. **Keeps CommonJS** — this migration does *not* require ESM.
**Tracker column:** Repo Standards Applied.

The target is the reference implementation's setup: `test` = `c8 node --env-file=.env.test --test`.
You do not get there in one PR. Jest and `node:test` run happily side by side, so you migrate suite
by suite with CI green the whole way.

## Why coexistence works

Jest and `node:test` discover tests independently. Point them at different file suffixes and they
never collide:

- Jest keeps `*.test.js`.
- `node:test` takes a new suffix, `*.node.test.js`.

Both run in CI; the build stays green while tests move across one at a time.

## Steps

### 1. Stand up the second runner (one PR)

Add the baseline `.c8rc.json` and a parallel script. Keep the existing `test` script untouched so
Jest's env setup and coverage thresholds keep working.

```jsonc
{
  "scripts": {
    "test": "jest",                                   // unchanged — existing suites
    "test:node": "c8 node --env-file=.env.test --test '**/*.node.test.js'",
    "test:all": "npm run test && npm run test:node"
  }
}
```

- CI runs `npm run test:all`.
- Add `c8` to devDependencies; `.c8rc.json` arrives from the baseline now (it is `staged-with` this
  migration in `file-policy.yaml`).

### 2. Reproduce Jest's environment under node:test

This is the one real gotcha. The repo's `jest.config.js` does work beyond discovery — port each part:

| Jest concern | Jest today | node:test equivalent |
| --- | --- | --- |
| Env vars (`DCS_JWT_SECRET`, SQS keys, `APP_ENV=test`, …) | set at top of `jest.config.js` | `.env.test` file + `node --env-file=.env.test` |
| `testTimeout: 20000` | config | per-test `{ timeout: 20000 }` or `--test-timeout` |
| Per-path `coverageThreshold` | config | `.c8rc.json` (global) + `c8 --per-file` if path-specific gates are needed |

> For `cica-apply-data-capture-service` specifically: move the ten `process.env.*` assignments from
> `jest.config.js` into a `.env.test` file (git-ignored real values; a `.env.test` with dummy values
> is allowlisted in `.gitleaks.toml`). The current per-path coverage (60% app / 35% db) is *lower*
> than the baseline 80% — keep the lower numbers in `.c8rc.json` initially and raise them as suites
> migrate, so adoption never fails CI on day one.

### 3. Migrate suites incrementally

- All **new** tests are written as `*.node.test.js`.
- Rewrite existing `*.test.js` suites one at a time: convert `jest.fn()`→`mock`/`node:test` mocks,
  `expect()`→`node:assert`, `describe/it` stay (node:test supports them). Rename to `*.node.test.js`.
- Each rewrite is a small, reviewable PR. CI keeps running both runners.

### 4. Retire Jest (final PR)

When no `*.test.js` files remain:

- Remove `jest`, `eslint-plugin-jest`, `jest.config.js`.
- Collapse scripts: `test` → `c8 node --env-file=.env.test --test`; delete `test:node`/`test:all`.
- Raise `.c8rc.json` thresholds to the baseline 80% if not already there.

## Definition of done

- No `*.test.js` or `jest*` remain.
- `npm test` runs `c8 node --env-file=.env.test --test` and passes at baseline coverage.
- Tracker "Repo Standards Applied" reflects the test-runner item complete.
