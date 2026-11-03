# Migration: ESLint + Prettier + airbnb-base → Biome

**Strategy:** short-lived coexistence, then a clean cutover. **Tracker column:** Repo Standards Applied.

Biome replaces *both* ESLint and Prettier (lint + format in one tool). Unlike the test migration, you
can't run "both suffixes" — a file has one formatter. So the approach is: stand Biome up alongside
ESLint briefly to compare output, reconcile the diffs, then cut over in a single reviewed PR and
delete the ESLint/Prettier toolchain.

## What the CICA repos actually use

The real configs (`cica-apply-data-capture-service`, `q-templates-application`) are consistent:

```js
extends: ['airbnb-base', 'prettier', 'plugin:jest/recommended']
rules: {
  'prettier/prettier': ['error'],
  'linebreak-style': ['error', win32 ? 'windows' : 'unix'],
  curly: ['error', 'all'],
  'jest/expect-expect': ['error'],
  strict: ['error', 'safe'],
  'import/extensions': ['off'],
  'no-param-reassign': ['error', {props: false}],   // data-capture-service
}
```

Formatting (`.prettierrc.js`): `tabWidth: 4`, `singleQuote: true`, `printWidth: 100`,
`bracketSpacing: false`, YAML at `tabWidth: 2`.

## Rule mapping (ESLint → Biome)

### Formatting — maps cleanly, with one deliberate change

| Prettier setting | Biome equivalent | Note |
| --- | --- | --- |
| `tabWidth: 4` | `formatter.indentWidth: 4` | matches |
| `singleQuote: true` | `javascript.formatter.quoteStyle: "single"` | matches |
| `printWidth: 100` | `formatter.lineWidth: 100` | matches |
| `bracketSpacing: false` | `formatter.bracketSpacing` | **baseline uses `true`** — see below |
| `linebreak-style` (OS-dependent) | `formatter.lineEnding: "lf"` + `.gitattributes` | baseline forces LF everywhere; drops the win32 branch |
| YAML `tabWidth: 2` | editorconfig / per-type override | handle via `.editorconfig` |

> **One intentional divergence:** the reference `biome.json` sets `bracketSpacing: true`, whereas the
> old Prettier config used `false`. This is a one-time reformat. It's cosmetic and lands in the
> cutover PR's reformat diff — call it out in the PR so reviewers expect brace-spacing churn.

### Lint — most of airbnb is covered by Biome's recommended presets

| ESLint rule | Biome equivalent |
| --- | --- |
| `curly: ['error', 'all']` | `style/useBlockStatements: "error"` (already in baseline) |
| `strict: ['error', 'safe']` | n/a — Biome handles module/strict semantics directly; drop it |
| `import/extensions: ['off']` | n/a — Biome's import handling differs; no equivalent needed |
| `no-param-reassign` (props:false) | `style/noParameterAssign` (baseline sets `warn`) |
| `prettier/prettier` | n/a — Biome *is* the formatter |
| `plugin:jest/*` | n/a — drop with the Jest migration; Biome has no jest plugin |
| airbnb correctness/style body | `linter.rules` recommended + the baseline's explicit extras (`noUnusedVariables`, `useConst`, etc.) |

**Residual airbnb rules with no Biome equivalent:** airbnb-base is large; a handful of stylistic
rules have no Biome counterpart. These are simply dropped — that is expected and acceptable. Biome's
recommended set plus the baseline's explicit rules is the new standard; do not try to reproduce
airbnb one-for-one.

## Cutover steps (single reviewed PR)

1. Add the baseline `biome.json` (from `common/`) and `@biomejs/biome` to devDependencies.
2. Replace scripts:
   ```jsonc
   "lint": "biome check",
   "lint:fix": "biome check --write",
   "format": "biome format --write"
   ```
3. Run `biome check --write` to reformat. Review the diff — most is formatting (incl. the
   `bracketSpacing` change). Fix any genuine lint findings.
4. Port the two behavioural rules worth keeping if a team wants them stricter than baseline
   (`noParameterAssign`); otherwise accept baseline defaults.
5. Remove ESLint/Prettier: delete `.eslintrc.js`, `.eslintignore`, `.prettierrc.js`,
   `.lintstagedrc.js` (or repoint lint-staged at Biome), and the `eslint*` / `prettier` /
   `eslint-config-airbnb-base` / `eslint-config-prettier` / `eslint-plugin-*` devDependencies.
6. Update Husky/lint-staged to call Biome (`biome check --staged --write` in pre-commit).

## Interaction with other migrations

- **Jest plugin:** `plugin:jest/recommended` and `jest/expect-expect` disappear naturally when the
  Jest → node:test migration completes. Order Biome after or alongside it to avoid re-adding jest
  lint config.
- **Husky v4 → v9:** the pre-commit hook that runs linting is rewritten in that migration; make sure
  it calls Biome, not ESLint, after cutover.

## Definition of done

- No `eslint*` / `prettier` config or dependencies remain.
- `npm run lint` runs `biome check` and passes.
- `.lintstagedrc.js` (if kept) and Husky hooks call Biome.
- Tracker "Repo Standards Applied" reflects the lint/format item complete.
