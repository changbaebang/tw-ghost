# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

The 1.0 preparation line. Two entries below are breaking (Node floor, public entry), so the next release is a
minor: **0.5.0**. From there the plan is a soak on 0.5.x with no breaking changes, then a 1.0.0 that is the same
code with the version and README changed — 1.0 is a statement that the surfaces named under *What is stable* in the
README do not break without a major, not a feature release.

### Added

- **`--format github` warns about findings whose file left the scanned root**, the same way `--format sarif` has
  since 0.4.0 — the annotation is kept, the exit code is unchanged, and one stderr line per run names how many
  annotations and files point outside the root, that GitHub cannot attach an annotation to a file outside the
  repository (so they appear only in the job log), and that running from the repository root or setting
  `GITHUB_WORKSPACE` makes the paths repo-relative. `formatGithub()` returns those lines as `warnings`, like
  `formatSarif()`. The inside/outside test and the warning text are now one definition shared by both formats.
- **README: *What is stable***, ahead of the support matrix, in English and Korean — the surfaces 1.0 will freeze
  (CLI flags and exit codes, `--json`, the SARIF shape with its `automationDetails.id` and upload-gate contracts,
  `--format github`, the ESLint rule's options, the programmatic API as documented), the deprecation policy (a
  runtime warning where possible plus a note in the README and here, for at least one minor before a major removes
  anything), and the Tailwind line (1.x is Tailwind 3.3–3.4; v4 would be a new major, not a minor).
- **`test/json-contract.test.ts`** pins every document the CLI writes under `--json` — single and multi analysis,
  single and multi `--env`, `init --json`, `--fix-map --json` — top-level and nested keys, and that `version` is the
  first key of each. **`test/public-api.test.ts`** pins the public entry: 33 runtime values and 48 types, as the
  type checker sees `src/index.ts`, and checks every value against the README.

### Changed

- **Node.js ≥ 22** (`engines`), CI on 22 and 24; **breaking**. Node 20 reached end-of-life on 2026-04-30 and
  starting the 1.0 line on it would have meant carrying it until 2.0. The workflow that `tw-ghost init` writes pins
  `setup-node` to 22 for the same reason.
- **`--json` is stable across minor releases**, not only across patches: a key may be added in a minor; none is
  removed or re-typed outside a major. (README, *Output example* and *What is stable*.)

### Removed

- **35 runtime exports left the public entry** (`tw-ghost`); **breaking**. The rule is now *a runtime value is
  exported iff the README names it* — types are not held to the README (each is reachable from a documented value's
  signature) but their set is frozen — pinned by `test/public-api.test.ts`. None of these was documented in the README; the 0.4.0 notes listed a few
  (`automationIdFor`, `configLabel`, `isMultiConfigRequest`, `sarifRules`, the `SARIF_*` constants) as programmatic
  API, and for those this is a breaking change. Removed: `CORE_UTILITY_ROOTS`, `collectRoots`, `DEFAULT_SEPARATOR`,
  `isPlausibleVariantChain`, `stripModifiers`, `utilityPart`, `utilityRoot`, `describeProject`, `formatEnv`,
  `isWholeToken`, `replacementFor`, `DEFAULT_MAX_ANNOTATIONS`, `automationIdFor`, `encodeUriPath`, `sarifRules`,
  `SARIF_MAX_SUGGESTIONS`, `SARIF_SCHEMA_URI`, `SARIF_TOOL_NAME`, `SARIF_URI_BASE_ID`, `SARIF_VERSION`, `GHOST_RULE_ID`,
  `UNKNOWN_UTILITY_RULE_ID`, `UNKNOWN_VARIANT_RULE_ID`, `ALL_CONFIGS_IGNORE_DIRS`, `configLabel`,
  `isMultiConfigRequest`, `assertTailwindV3`, `COMPATIBILITY_DOCS`, `contentGlobs`, `contentWarnings`,
  `MIN_TAILWIND_VERSION`, `SUPPORTED_TAILWIND_RANGE`, `unwrapDefaultExport`, `flattenThemeKeys`,
  `matchUtilityPrefix`, `withinOneEdit`. Type exports are unchanged.
  Migration: `automationIdFor(config)` is `` `tw-ghost/${config}` `` with `config` as `ConfigReport.config` reports
  it; `SARIF_*` values are the literals in the emitted log (`$schema`, `version: "2.1.0"`, `uriBaseId: "%SRCROOT%"`,
  rule ids `ghost-class` / `unknown-utility-like` / `unknown-variant`); the version range is `tailwindcss` `^3.3.0`
  as declared in `peerDependencies`. Anything else had no documented use — if you relied on one, open an issue with
  the use case.

### Security

- Transitive **esbuild ≥ 0.28.1** via `pnpm.overrides` (`^0.28.1`), closing the dependabot advisory on 0.27.x
  (arbitrary file read from esbuild's dev server on Windows). Development-only: esbuild is pulled in by `tsup` and
  `vite`/`vitest` and does not ship in the package, so users were never exposed. The override holds `tsup` above its
  declared `^0.27.0`; CI's build step is the compatibility check, and the override goes when tsup moves its range.

## [0.4.0] - 2026-09-24

### Added

- **`tw-ghost init`**: scans once and scaffolds the project — a GitHub Actions workflow whose install steps and
  runner match the detected package manager (`packageManager`, else the lockfile: pnpm / yarn / npm / bun) and
  whose analysis step uploads SARIF (`--no-sarif` for `--format github` instead), plus a fix-map draft when the
  scan finds ghosts. The SARIF step names its shell (`shell: bash`), records tw-ghost's exit code and gates the
  upload on it — `0` and `1` upload, `2` does not, because exit `2` means a config failed to load and its runs are
  absent, so uploading would retire their alerts as though the classes had been fixed. Ghosts still fail the job.
  Never overwrites (existing files are reported as `exists`), installs nothing, and exits `0`
  even with findings. Flags: `--dry-run`, `--no-sarif`, `--no-fix-map`, `--workflow <name>`, `--config`, `--json`.
  Programmatic: `init()`, `renderWorkflow()`, `detectPackageInfo()`, `formatInit()`.
- **`--format sarif`**: a [SARIF 2.1.0](https://docs.oasis-open.org/sarif/sarif/v2.1.0/sarif-v2.1.0.html) log on
  stdout, for `github/codeql-action/upload-sarif` — ghosts become tracked **code scanning alerts** instead of
  annotations that vanish with the check run. One `result` per **occurrence**, never capped (`--max-annotations`
  does not apply and `--max-locations` is forced to *all*; GitHub's own top-5,000-per-run limit still applies at
  upload). `tool.driver` carries `name` / `version` / `semanticVersion` / `informationUri` and declares only the
  rules the run can produce: `ghost-class` (`error`) always, `unknown-utility-like` and `unknown-variant` (`note`)
  with `--unknown`; each rule has `shortDescription`, `fullDescription`, `help` (text + markdown),
  `defaultConfiguration.level` and `properties.tags`. Each result has `ruleId` / `ruleIndex` / `level`, a
  `message.text` naming the class, the declarations stock Tailwind would have set and up to 3 suggestions, a
  `physicalLocation` with a repo-relative percent-encoded `uri` under `uriBaseId: "%SRCROOT%"` and a 1-based
  `region` covering exactly the class. **No `partialFingerprints`**: code scanning reads only
  `primaryLocationLineHash`, which `upload-sarif` computes from the source whenever a result lacks that key. A
  custom key would not have blocked that, but it would be carried and never read — a tracking claim nothing
  honours — so none is emitted. Fingerprinting depends on the `uri` resolving to a file: the action's
  `resolveUriToFile` ignores `uriBaseId` and joins a relative path onto the source root, which a test asserts for
  files under the scanned root. A `uri` outside the scanned root — `../` when a `content` glob climbs above the
  scanned directory with no workspace covering it, or on Windows an absolute `D:/…` / `//server/…` when the file
  is on another drive or UNC share — is outside that contract: the result is **kept** — the ghost is real — and
  one stderr warning per run names how many results and files point outside the root, what code scanning cannot
  do with them, and that running from the repository root or setting `GITHUB_WORKSPACE` makes them repo-relative.
  `formatSarif()` / `formatSarifMany()` return those lines as `warnings`. The exit code is unaffected.
  Inside/outside is decided by path segment, so a repository directory whose name starts with `..` (`..shared/`)
  is inside — previously a `startsWith('..')` test sent it down the cwd-relative fallback, which also mis-shaped
  `--format github`'s `file=` for such paths.
  Verified by upload: 13 findings in one file over 9 distinct line hashes became 13 alerts, and moving the block
  without editing it kept all 13 alert numbers. Exit codes unchanged; the
  one-line summary goes to stderr because stdout is redirected into the `.sarif` file.
- **Several configs → several SARIF runs**: `--all-configs` / repeated `--config` emit one `run` per config, each
  with `automationDetails.id` of `tw-ghost/<config path>` and repo-relative `uri`s throughout. Configs that failed
  to load contribute no run. The id follows the **request**, not a count — neither how many configs succeeded nor
  how many were found — so a multi-config request that matches one config is still named, and a sibling config
  breaking or being deleted does not rename the one that stayed. (Code scanning keys an analysis by that id; a
  rename retires and re-opens the alerts of a config that never changed.) A single-config request — a `--config`
  naming one path, or auto-detection — carries no `automationDetails`, so `upload-sarif`'s `category:` names it;
  the action fills that field only when it is absent, so it never overwrites the per-config ids.
- Programmatic API: `formatSarif()`, `formatSarifMany()`, `automationIdFor()`, `configLabel()`,
  `isMultiConfigRequest()`, `sarifRules()`, `encodeUriPath()`,
  `SARIF_SCHEMA_URI`, `SARIF_VERSION`, `SARIF_URI_BASE_ID`, `SARIF_MAX_SUGGESTIONS`,
  `SARIF_TOOL_NAME`, `GHOST_RULE_ID`, `UNKNOWN_UTILITY_RULE_ID`, `UNKNOWN_VARIANT_RULE_ID` and the `Sarif*` types.
- **ESLint plugin** as a subpath, `tw-ghost/eslint` (ESLint ≥ 9 flat config, no ESLint dependency): rule
  `tw-ghost/no-ghost-class` reports every ghost class in `className` / `class` attributes (literals, template
  text, ternaries, `&&`, arrays, object keys) and in `clsx`/`cx`/`cn`/`classnames`/`cva`/`tv`/`twMerge`/`twJoin`
  calls, at the token, with the CSS stock Tailwind would have produced. Options: `config`, `callees`,
  `attributes`, `ignore`, `reportUnknownVariant`, `reportUnknown`. `configs.recommended` included.
- **Live classifier** (`createLiveClassifier(configPath)`): synchronous per-candidate verdicts through Tailwind's
  JIT internals (`createContext` + `generateRules`) — ~20–300 ms to build both contexts, then thousands of classes
  per millisecond — giving the same `ok` / `ghost` / `unknown-variant` / `unknown` as `analyze()` (verified against
  every fixture). Also `stockDeclarations(candidate)`.

### Fixed

- **Windows: globs with backslash separators matched nothing.** Patterns reached the glob engine verbatim, and
  picomatch reads `\` as an escape rather than a separator — so `tw-ghost "src\**\*.tsx"` from a Windows shell,
  or a `content: ['.\\src\\**\\*.tsx']` written there, failed with *No files matched*. `--config
  "apps\*\tailwind.config.*"` was worse: not recognised as a glob at all, so it was resolved as a literal path
  and reported *Config file not found*. Separators are now rewritten on win32 only, where `\` cannot be an escape;
  POSIX escapes are untouched.
- **Windows: `--fix-map --write` rewrote every line of a mixed-ending file.** The EOL rule was "any CRLF anywhere →
  CRLF for the whole file", so one stray CRLF in a mostly-LF file converted all of it and buried the real diff.
  Each line now keeps its own terminator, and a file without a trailing newline stays that way.
- **UTF-8 BOM.** A BOM (Visual Studio, Notepad, PowerShell 5.1 `Set-Content`) was counted as part of line 1, so
  every reported column on that line — `::error col=` annotations included — was off by one; it is now skipped
  when scanning and written back untouched when fixing. `--fix-map` also accepts a map file with a BOM instead of
  failing with *invalid JSON*.

## [0.3.0] - 2026-09-21

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
- `--fix-map-init <file>` writes a fix-map draft from the current ghosts (bare utility → single suggestion,
  candidate list, or `null`); `--fix-map <file>` applies a decided map — replacing or removing every
  occurrence, carrying variants / `!` / `-` over, whole-token only, dry run by default, `--write` to apply.
  Exit 1 while any ghost remains unmapped. JSON: `{ "fix": { write, edits, files, unused, unmapped } }`.
- Report: `separator` (top level) and `files` per ghost (all files the class occurs in, never clipped).
- Programmatic: `applyFixMap`, `applyFixMapToText`, `draftFixMap`, `parseFixMap`, `replacementFor`, `formatFix`.
- `--unknown-all`: with `--unknown`, put every raw unknown token in the list (and in the `unknown`
  JSON array) instead of the utility-like subset. Programmatic: `analyze({ unknownAll: true })`,
  `formatHuman(report, { unknownAll: true })`.
- Human `--unknown` output has a header with both counts:
  `? Unknown utility-like classes (N shown, M raw; use --unknown-all for everything):`
  (`? Unknown classes, everything (M shown, N utility-like; …)` with `--unknown-all`).
- Programmatic API: `buildUtilityVocabulary`, `matchUtilityPrefix`, `withinOneEdit`,
  `UtilityVocabulary`, `VocabularyOptions`.
- Fixture `unknown-noise` and tests for the identifiers that must be excluded (`my-page`,
  `no-op`, `bottom-start`, `box-center`, `data-state`), the typos that must be listed (`text-mm`,
  `px-13`, `rounded-xll`, `gap-2.25`), `--unknown-all`, sort order and the JSON shapes.

### Changed

- **Breaking for `--unknown --json` consumers:** the utility-like heuristic behind the `unknown`
  array is much stricter, so the list is shorter and different. It used to accept any token
  whose *root* was a utility root, which let identifiers such as `my-page`, `no-op`,
  `bottom-start`, `box-center` and every `px-16)`-style punctuation tail through (on a large
  real-world app: ≈93,000 raw unknowns, 315 listed, most of them noise). It now also requires
  the *value* to look like one that utility can take — numeric / fraction / arbitrary, a theme
  key of the sections that utility reads (project and stock), a keyword of that utility, a
  generic keyword (`auto`, `full`, `none`, `px`, `screen`, …), one edit away from any of those,
  or the head of a nested key — with the value-taking prefix matched longest-first (`min-h`, not
  `min`) and the project `prefix` stripped. Same app: 20 listed. `summary.unknown` (raw) and
  `summary.unknownUtilityLike` keep their meaning; `unknown` holds the utility-like subset unless
  `--unknown-all` is given. Anything that needs the old, permissive list should pass
  `--unknown-all` and filter itself.
- The raw `unknown` list (`--unknown-all`) is sorted by occurrence count descending, then by
  name, like the utility-like list and `unknownVariant` already were.
- Programmatic API: `looksUtilityLike(candidate, vocabulary, separator)` now takes a
  `UtilityVocabulary` (from `buildUtilityVocabulary`) instead of a `Set` of roots and lives in
  `src/vocabulary.ts`; `collectRoots` and `CORE_UTILITY_ROOTS` are still exported but no longer
  drive the heuristic.
- README: `--unknown` / `--unknown-all` option rows, the JSON note, the heuristic description and
  a new *Known sources of noise in `--unknown`* section, in English and Korean.

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
