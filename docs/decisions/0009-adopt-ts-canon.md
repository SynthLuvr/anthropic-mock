# ADR 0009: Adopt ts-canon and sync with typescript-template

| Field  | Value                           |
|--------|---------------------------------|
| Status | Accepted                        |
| Date   | 2026-08-29                      |
| Tags   | tooling, lint, format, ci, deps |

## Context

This repo grew the same TypeScript dev toolchain that every other repo
in the org carried by hand: a `lint`/`format` script block in
`package.json` (12 per-step scripts driven by `npm-run-all`), local
copies of `scripts/pandoc-md.mts` and `scripts/peer-deps.mts`, four
ast-grep rule files under `.ast-grep/rules/`, a 140-line inline
`biome.json`, and seven tool devDependencies (`@biomejs/biome`,
`oxlint`, `oxlint-tsgolint`, `@ast-grep/cli` plus a platform pin,
`convert-to-arrow`, `npm-run-all2`). Every rule tweak or tool bump had
to be copied into each repo, and the copies had already drifted: this
repo pinned biome `^2.5.4` and an older oxlint while
[`typescript-template`](https://github.com/SynthLuvr/typescript-template)
moved ahead.

[ts-canon](https://github.com/SynthLuvr/ts-canon) (ADR-less spike:
`ts-canon/docs/design.md`) exists to collapse exactly this surface into
one dependency: it bundles the tools, ships the canonical biome /
tsconfig / vitest presets and the ast-grep rules, and provides
`ts-canon lint` / `format` / `doctor` / `migrate`. `typescript-template`
has itself already migrated to it and is now the canonical consumer
shape — syncing with the template therefore means adopting ts-canon
here.

## Decision

1.  Run `ts-canon migrate` and keep its output:

    - `lint` → `ts-canon lint`, `format` → `ts-canon format`; drop the
      12 per-step scripts (including the leftover `strip-braces` helper,
      which the migrator does not know).
    - Delete `scripts/pandoc-md.mts`, `scripts/peer-deps.mts`, and
      `.ast-grep/rules/` (byte-identical to the shipped rules — verified
      before deletion).
    - Swap the seven tool devDependencies for `ts-canon ^0.1.0`. `execa`
      and `ky` stay: tests import them directly. `tsx` stays in
      `dependencies`: the published `bin/llm-mockingbird` runs on it.

2.  Take the template’s consumer shape verbatim where the migrator
    stops:

    - `biome.json` reduced to
      `extends: ts-canon/presets/biome.preset.json` (the preset is
      byte-identical to the old inline config).
    - `tsconfig.json` extends `ts-canon/presets/tsconfig.base.json`
      (same compiler options).
    - `vitest.config.ts` uses the `ts-canon/presets/vitest` factory.
    - `.oxlintrc.json` gains the template’s six extra safety rules.
    - Add `.gitattributes` (LF normalization), `.node-version` (`26`),
      `sgconfig.yml` (points bare `ast-grep scan` at the shipped rules),
      `coverage`/`report` in `.gitignore`, and `scriptShell: bash` in
      `pnpm-workspace.yaml`.
    - `packageManager` → `pnpm@11.22.0`; `test` →
      `vitest run --coverage` (80% thresholds via the preset) with
      `test:watch` alongside; CI moves to the template’s ubuntu/windows
      matrix with pinned pandoc on both.
    - `AGENTS.md` synced to the template’s (new Toolchain section).

3.  Deduplicate the within-file test clones that the newly-gated jscpd
    step (5% threshold) flagged — the repo sat at 5.06%: extract
    `expectCannedFallback` (rules tests), `expectEphemeralServer` /
    `expectCloseStopsServer` (create-mock tests), and
    `expectProfileReachesMock` (goose CLI tests). Duplication drops to
    3.67% without touching assertions.

## Consequences

- One devDependency replaces seven; rule/preset/tool changes now land by
  bumping `ts-canon`, and reverting this PR is the rollback.
- New gates arrive with the package and must stay green: jscpd
  duplication \< 5%, `pnpm audit --prod`, `pnpm peers check`, the six
  extra oxlint rules, and 80% coverage in `pnpm test` (currently 92%
  statements / 86% branches overall).
- pnpm 11.22’s `minimumReleaseAge` quarantine holds back freshly
  published ts-canon versions (0.1.3 resolved to 0.1.1 at migration
  time); the spec stays `^0.1.0` so newer versions flow in once they age
  past the window. No `minimumReleaseAgeExclude` was committed.
- The biome `$schema` URL in the preset (2.5.10) trails the bundled
  biome (2.5.11), which logs an informational (non-failing) note.
- `ts-canon doctor` is the first stop for toolchain/environment
  failures; `lint --fast` skips audit/jscpd for quick local loops.
- CI now runs on windows-latest too (template parity); ts-canon’s
  Windows/AppLoader contract (absolute-path spawning,
  `scriptShell: bash`, pandoc `--eol=lf`) is what makes that viable.
