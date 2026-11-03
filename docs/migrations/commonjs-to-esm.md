# Migration: CommonJS → ESM

> **Status: DEFERRED (org decision).** ESM is **optional** and **not required** for the
> `node-service` profile. A repository can be fully baseline-compliant while remaining CommonJS.
> This guide exists so that *if* a team chooses to migrate, they do it consistently — but nothing in
> adoption, sync, or the drift report requires it. It is **not** a tracked compliance gate.

## Why it is deferred

- **It is decoupled from the test-runner migration.** `node:test` runs CommonJS fine, so the Jest →
  node:test migration delivers its value without touching modules. Coupling the two only adds risk.
- **It is all-or-nothing at the package level.** Setting `"type": "module"` converts *every* `.js`
  file to ESM at once, breaking every `require()`. There is no safe half-flip of a package.
- **The payoff is low relative to the risk** for existing, working CommonJS services. Deferring lets
  teams spend migration effort on changes that matter more (security, CI, tests).

## If you do migrate later

Do it only when the repo is otherwise on the baseline, as a single well-tested PR. Expect to handle:

- Rename `require()` → `import` and `module.exports` → `export` across the codebase.
- Replace `__dirname` / `__filename` with `import.meta.url` + `fileURLToPath` (the `path` usage in
  services like `cica-apply-data-capture-service`'s `app.js` relies on these).
- Fix runtime spec/asset paths that assumed CJS resolution (e.g. `express-openapi-validator`
  pointing at `openapi.json`).
- Update any dynamic `require()` to dynamic `import()`.
- Add `"type": "module"` and set `.c8rc.json`/node flags accordingly.

### Interim option without flipping the package

If a team wants *new* code to be ESM before a full flip, write new leaf modules as `.mjs` (always
ESM regardless of `"type"`). Caveat: a `.cjs`/CommonJS module cannot cleanly `require` an `.mjs`
module, so this only works for leaf modules the CJS code doesn't import. Shared modules must wait for
the full flip.

## Definition of done (only if attempted)

- `"type": "module"` set; no `require()`/`module.exports` remain.
- Tests and runtime pass.
- This remains **off** the compliance checklist — it is recorded as an informational note, not a
  required standard.
