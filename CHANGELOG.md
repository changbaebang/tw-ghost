# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-09-15

### Added

- `tw-ghost` CLI: finds Tailwind v3 classes that produce CSS in stock Tailwind but nothing in
  the project's own config ("ghost" classes), using the project's own `tailwindcss` install.
- Per-ghost report with occurrence count, `file:line:col` locations, the declarations stock
  Tailwind would have emitted, and same-root replacement suggestions from the project theme.
- Variant-aware classification: a candidate with a variant chain that resolves in neither run is
  judged by its bare utility, so `tablet:text-sm` (custom screen), `hocus:text-sm` (`addVariant`),
  `dark:md:hover:text-sm` and `[&_svg]:text-sm` are ghosts when `text-sm` is dead. The stock run
  uses the default screens merged with the project's, so a removed stock breakpoint (`2xl:p-4`
  after replacing `screens`) is a ghost too. Variants are split on the configured `separator`
  (default `:`) at bracket depth 0 only.
- New classification `unknown-variant` (utility works, variant chain does not) — listed with
  `--unknown` as `unknownVariant`, counted in `summary.unknownVariant`.
- `summary.unknownUtilityLike`: the heuristic-filtered unknown count, always present so CI sees a
  meaningful number without `--unknown` (`summary.unknown` stays the raw count).
- `--allow-empty`: opt back into exit `0` for an empty scan. Without it, zero matched files, a
  non-existent positional path or a config without string `content` globs exit `2` with a
  message naming the globs and base directory.
- `--json`, `--unknown`, `--max-locations`, `--ignore` (repeatable regex), `--fail-on ghost|none`,
  `--no-suggestions`, `--no-color`, `--help`, `--version`.
- Config auto-detection (`tailwind.config.{ts,js,cjs,mjs}`, walking up from cwd); TypeScript
  configs via Tailwind's `loadConfig`.
- Exit codes: `0` clean, `1` ghosts found, `2` usage / config error (including Tailwind v4 and
  an empty input set).
- Programmatic API (`analyze`, `formatHuman`, `loadProject`, `classify`, `splitVariants`,
  `scanContent`, …) with ESM and CJS builds and per-condition type definitions
  (`import` → `index.d.ts`, `require` → `index.d.cts`).
- Fixtures: `replaced-scale`, `prefix`, `clean`, `variants`, `separator`, `count`, `no-content`.

### Changed

- Occurrence counting matches whole tokens only: `text-sm` is no longer counted inside
  `md:text-sm`, `legacy-text-sm` or `text-sm/50`, and `p-3` is no longer counted inside `p-30`,
  `!p-3`, `-p-3` or `p-3.5`. Counts and `file:line:col` columns now point at real uses.
- `--max-locations` rejects non-integer input (`3abc`, `1.5`) with exit `2` instead of truncating.
- Tailwind's `warn - No utility classes were detected` message is filtered from stderr during
  tw-ghost's own generation runs (it fires whenever every candidate is a ghost); other Tailwind
  warnings still pass through.
- `package.json`: `postcss` ^8 declared as an optional peer dependency (falls back to the
  `postcss` shipped with `tailwindcss`); `bin` points at `dist/cli.js`;
  `publishConfig.registry` pinned to `https://registry.npmjs.org/`.
