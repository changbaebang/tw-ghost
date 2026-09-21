# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- `--format <human|json|github>` (default `human`). `--json` stays as an alias for `--format json`.
  `github` prints one `::error file=…,line=…,col=…,title=tw-ghost::<class> produces no CSS in this
  Tailwind config — try: …` workflow-command annotation per ghost **occurrence** (every location,
  `--max-locations` is ignored), `file=` relative to `GITHUB_WORKSPACE` when set, `%` / CR / LF
  (and `,` / `:` in properties) escaped per the spec, `--unknown` findings as `::warning` with
  title `tw-ghost (unknown)`, and a `tw-ghost: N ghost classes, M occurrences` summary on stderr.
  Exit codes unchanged.
- `--max-annotations <n>` (default `50`, `0` = all): caps the `github` output and ends it with
  `::notice::tw-ghost: K more annotations omitted` — GitHub shows only 10 annotations per level per
  step / 50 per job.
- Programmatic API: `formatGithub()`, `DEFAULT_MAX_ANNOTATIONS`, `GithubFormatOptions`,
  `GithubFormatResult`.
- README: **CI** subsection with a minimal workflow step, in English and Korean.
- **Monorepo support: several configs in one run.** `--config` is now repeatable and accepts
  globs (`--config 'apps/*/tailwind.config.ts'`, `node_modules` skipped); `--all-configs`
  discovers every `tailwind.config.{ts,js,cjs,mjs}` under cwd (skipping `node_modules`, `dist`,
  `.next`, `build`, `out`, `coverage`) and exits 2 naming the searched root when it finds none.
  Auto-detection without `--config` is unchanged (nearest config walking up from cwd). Each config
  is analyzed independently from its own directory; positional globs apply to every config; a
  shared file is reported under every config that scans it (no cross-config de-duplication).
- Multi-config output: human format prints `== <config> (N files, K ghosts)` blocks and a
  `total:` line; `--json` becomes `{ version, configs: [{ config, …report } | { config, error }],
  summary, durationMs }` **only when more than one config is analyzed** — a single config keeps
  the existing document byte for byte. `--env` prints one block (or JSON entry) per config.
- Exit codes with several configs: `1` if any config has ghosts (`--fail-on` respected), `2` if
  any config fails to load or scan — that config is reported as `{ config, error }`, the others
  are still analyzed, stderr says how many failed.
- Programmatic API: `analyzeMany(configs, options)`, `resolveConfigPaths({ configs, all, cwd })`,
  `formatHumanMany()`, `isConfigFailure()`, `ALL_CONFIGS_IGNORE_DIRS`, and the `MultiReport` /
  `MultiSummary` / `ConfigReport` / `ConfigFailure` / `ConfigResult` types. `analyze()` is
  unchanged.
- Fixtures `monorepo` (two apps replacing different scales plus a shared package both scan) and
  `broken-config` (a config that throws); `test/multi.test.ts`.

## [0.2.0] - 2026-09-17

### Added

- **Preflight checks with actionable exit-2 messages** (no more `unexpected error` + stack trace):
  Tailwind 4.x / ≤ 2.x (`Unsupported Tailwind CSS version: found 4.1.14, tw-ghost supports
  3.3.x – 3.4.x only …`, v4 message says the tool is v3-only and links the README), Tailwind
  3.0–3.2 (`found 3.2.7, need >=3.3.0` — `tailwindcss/loadConfig` appeared in 3.3.0), a 3.3+
  install missing `loadConfig` / `resolveConfig`, a config that exports a function, a config that
  exports `null` / a primitive (says what it got), and `resolveConfig` throwing.
- `--tailwind <dir>`: resolve `tailwindcss` (and `postcss`) from a directory other than the config
  file's, for layouts where the config's folder cannot reach the install. The "Could not resolve
  tailwindcss" error now explains where resolution starts and suggests it.
- `--env` (also `--env --json`): prints the resolved config path, `tailwindcss` version + path,
  `postcss` version + path, extractor kind, content globs and flags, `prefix` / `separator` /
  `important` / `darkMode` and warnings — what to paste into a bug report. Exits 2 with the
  regular preflight message when the project is unsupported.
- Warnings for degraded runs, printed once on stderr as `tw-ghost: warning: …` and returned in
  `report.warnings` (new key in `--json`, exit code unaffected): `content.transform` /
  `content.extract` present (not applied), and the bundled-extractor fallback.
- README: new **Requirements & compatibility** section (support matrix, what is scanned / not
  scanned, every exit-2 condition and warning with its message prefix, `--env` example), in
  English and Korean.
- Programmatic API: `analyze({ tailwind })`, `loadProject(path, { tailwindDir })`,
  `describeEnvironment()`, `describeProject()`, `formatEnv()`, `assertSupportedTailwind()`,
  `contentWarnings()`, `unwrapDefaultExport()`, `MIN_TAILWIND_VERSION`,
  `SUPPORTED_TAILWIND_RANGE`, `COMPATIBILITY_DOCS`; `LoadedProject` gains `tailwindPackageDir`,
  `postcssPath`, `postcssPackageDir`, `postcssVersion`, `warnings`.
- Fixture `content-transform`; `test/preflight.test.ts` builds throwaway projects with a fake
  `node_modules/tailwindcss` to exercise every version branch.

### Fixed

- ESM configs (`.mjs`, or `.js` under `"type": "module"`) with **Tailwind 3.3.0** were read as
  `{ default: config }` (3.3.0's `loadConfig` does not unwrap the module record), which ended in
  `Nothing to scan`. tw-ghost now unwraps the default export itself.

### Changed

- `assertTailwindV3` is kept as a deprecated alias of `assertSupportedTailwind`; it now also
  rejects 3.0–3.2 (previously those crashed later with `Cannot find module 'tailwindcss/loadConfig'`).

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
