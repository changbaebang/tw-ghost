# tw-ghost

**Find Tailwind classes that silently generate no CSS in *your* config.**

[한국어](./README.ko.md)

## The problem

Tailwind v3 lets a project *replace* a theme scale instead of extending it:

```ts
// tailwind.config.ts
export default {
  theme: {
    fontSize: { xs: '10px', s: '12px', m: '13px', l: '14px' }, // stock sm/base/lg/xl are gone
    spacing: { 0: '0px', 2: '2px', 4: '4px', 8: '8px' },        // 1 unit = 1px, even keys only
    zIndex: { nav: '200', mask: '1000', popup: '3000' },
  },
};
```

From that moment on, every stock class that used a removed key is a **ghost**: it still looks
valid, every editor plugin autocompletes it, code review waves it through — and Tailwind emits
nothing for it. The browser ignores the unknown class, the element renders with whatever it
inherits, and nobody notices until a designer asks why the padding is off.

```tsx
// Before: looks fine, does nothing
<p className="text-sm p-3 z-10 tablet:text-sm">…</p>

// What tw-ghost tells you
  text-sm  (16 occurrences)
    src/components/Price.tsx:12:20
    stock: font-size: 0.875rem; line-height: 1.25rem
    try:   text-s, text-m
  tablet:text-sm  (4 occurrences)
    stock: font-size: 0.875rem; line-height: 1.25rem
    try:   tablet:text-s, tablet:text-m
  p-3      (3 occurrences)
    stock: padding: 0.75rem
    try:   p-2, p-4
  z-10     (7 occurrences)
    stock: z-index: 10
    try:   z-nav, z-mask, z-popup

// After
<p className="text-m p-4 z-nav tablet:text-m">…</p>
```

## What it does / does not do

**Does**

- Loads your `tailwind.config.{ts,js,cjs,mjs}` with **your project's own `tailwindcss` install**
  (TypeScript configs, presets, plugins, `prefix`, `separator`, `important`, `darkMode` all honoured).
- Extracts class candidates from your source files with Tailwind's own extractor.
- Generates CSS twice — once with your config, once with a stock theme — and compares **what
  actually came out**. No guessing from the config shape.
- Catches ghosts behind variants too: `md:text-sm`, `dark:md:hover:text-sm`, and also
  `tablet:text-sm` / `hocus:text-sm` / `[&_svg]:text-sm` where the variant only exists in your
  config — the class is judged by its bare utility when the full candidate resolves nowhere.
- Reports each ghost with occurrence count, `file:line:col`, the declarations it *would* have
  produced in stock Tailwind, and same-root replacement suggestions from your theme.
- Runs as a CI gate (`exit 1` on findings, `--json` for tooling, `exit 2` when nothing was scanned).

**Does not**

- Infer validity from the config shape. [eslint-plugin-tailwindcss](https://github.com/francoismassart/eslint-plugin-tailwindcss)
  (`no-custom-classname`) and [eslint-plugin-better-tailwindcss](https://github.com/schoero/eslint-plugin-better-tailwindcss)
  (`no-unknown-classes`) do; tw-ghost judges by actual CSS output, both in the CLI and in its own ESLint rule
  (`tw-ghost/no-ghost-class`, see *ESLint*). The CLI stays linter-independent for Biome / oxlint teams.
- Detect classes built dynamically at runtime (`` `text-${size}` ``). Tailwind cannot see those
  either — they are broken in production already, not just in this report.
- Support Tailwind v4 (CSS-first config, no `tailwind.config.js`) or Tailwind older than 3.3. It exits
  with code 2 and a message naming the version it found (see *Requirements & compatibility*).
- Report "unknown" classes (custom CSS, plain words, typos) by default — see `--unknown` for the
  utility-like ones (typos, dead tokens) and `--unknown-all` for the raw list.

## Install & usage

```sh
# run in the directory that owns tailwind.config.* (auto-detected by walking up)
npx tw-ghost

# explicit config + explicit globs
npx tw-ghost "src/**/*.{ts,tsx}" --config apps/web/tailwind.config.ts

# CI: machine-readable, ignore a legacy prefix, also list typos and unknown variants
npx tw-ghost --json --ignore "^legacy-" --unknown

# monorepo: every tailwind.config.* under the current directory, one JSON document
npx tw-ghost --all-configs --json
```

### CI

In a GitHub Actions step, `--format github` turns every ghost occurrence into an inline
annotation on the pull request (the exit code is the same as for the other formats, so the step
still fails):

```yaml
- run: npx tw-ghost --format github
```

Each line is a workflow command, one per occurrence, with `file=` relative to `GITHUB_WORKSPACE`
(or to the current directory when the file is outside it / the variable is unset):

```
::error file=src/App.tsx,line=7,col=21,title=tw-ghost::text-sm produces no CSS in this Tailwind config — try: text-l, text-m
```

`unknown` / `unknownVariant` findings are only annotated with `--unknown`, as `::warning`
with the title `tw-ghost (unknown)`. `%`, CR and LF are escaped in every message and `,` / `:`
additionally in `file=`, per the workflow-command spec. A one-line summary
(`tw-ghost: 5 ghost classes, 8 occurrences`) goes to stderr so it does not become an annotation.

GitHub only surfaces **10 annotations of each level (error / warning / notice) per step, and
50 per job** in the checks UI; the rest are still in the log but not shown inline
([limits documented in `actions/toolkit`](https://github.com/actions/toolkit/blob/main/docs/problem-matchers.md#limitations)).
`--max-annotations` (default `50`) caps what is printed and ends the output with
`::notice::tw-ghost: K more annotations omitted` so the cut is visible. `--json` is unchanged and
remains the format for tooling.

Requires Node ≥ 20 and `tailwindcss` 3.3–3.4 installed in the target project (peer dependency).
`postcss` ^8 is an *optional* peer: tw-ghost uses the project's `postcss` when one is installed
next to the config and otherwise falls back to the `postcss` that `tailwindcss` itself depends on,
so a plain `tailwindcss` install is enough. Not sure it fits your setup? Run `npx tw-ghost --env`
— it either prints what it resolved or fails with the exact reason (exit 2).

### ESLint

The same verdicts, in the editor, while typing. tw-ghost ships an ESLint plugin as a subpath — no extra
package, no ESLint dependency of its own (ESLint ≥ 9, flat config):

```js
// eslint.config.js
import twGhost from 'tw-ghost/eslint';

export default [
  // …your existing config…
  twGhost.configs.recommended, // rule `tw-ghost/no-ghost-class` as "error"
];
```

```jsx
<div className="text-sm p-3" />
//              ~~~~~~~ `text-sm` produces no CSS in this Tailwind config
//                      (stock Tailwind would set font-size: 0.875rem; line-height: 1.25rem).
```

What the rule looks at: string literals and template-literal text in `className` / `class` attributes
(also inside `cond ? 'a' : 'b'`, `cond && 'a'`, arrays, and the keys of `{ 'a': cond }`), and the arguments
of `clsx`, `cx`, `cn`, `classnames`, `cva`, `tv`, `twMerge`, `twJoin` (`callees` option). Dynamic pieces
(`` `text-${size}` ``) are skipped, as Tailwind itself skips them. Each class is judged by the project's own
`tailwindcss` through its JIT engine synchronously — the config is loaded once per `tailwind.config.*`
(found by walking up from the linted file, or set with `config`) and re-loaded when its mtime changes.

Options (all optional):

| Option | Default | Meaning |
| --- | --- | --- |
| `config` | nearest `tailwind.config.*` above the file | Path to the config (relative to the ESLint cwd). |
| `callees` | `clsx, cx, cn, classnames, classNames, cva, tv, twMerge, twJoin` | Functions whose string arguments hold classes. |
| `attributes` | `className, class` | JSX attributes to scan. |
| `ignore` | `[]` | Regexes; matching classes are skipped. |
| `reportUnknownVariant` | `false` | Also report `unknown-variant` (valid utility under a variant this config does not know). |
| `reportUnknown` | `false` | Also report utility-looking classes that produce no CSS anywhere (typos). Noisy; prefer `--unknown` in the CLI. |

Setup problems are reported once per file as a lint message (`tw-ghost could not load the Tailwind config: …`,
`tw-ghost found no tailwind.config.*…`) instead of crashing the lint run. The CLI's `--fix-map` is the way to
fix findings in bulk; the rule has no autofix because the replacement is a design decision (see *Fixing ghosts*).

**How this differs from `eslint-plugin-tailwindcss`.** That plugin infers validity from the config object;
this rule asks Tailwind's engine whether the class *generates CSS* in your config and in stock Tailwind, so a
replaced scale (`fontSize` without `sm`) is a finding and a custom plugin utility is not. Biome / oxlint users
keep the CLI; there is no plugin API to hook into there.

### Monorepos

Without `--config`, tw-ghost loads the **nearest** `tailwind.config.*` walking up from the current
directory — it never discovers every config in a tree on its own. To check several apps in one run,
name them or let tw-ghost find them:

```sh
# recommended from the repository root: every tailwind.config.{ts,js,cjs,mjs} below cwd
npx tw-ghost --all-configs

# or pick them explicitly: --config is repeatable and accepts globs
npx tw-ghost --config 'apps/*/tailwind.config.ts' --config packages/ui/tailwind.config.js
```

- Each config is analyzed **independently, from its own directory**: its `content` globs resolve
  relative to the config file exactly as in a single run, and its own `tailwindcss` install judges
  it. Positional globs, when given, are resolved from cwd and applied to **every** config.
- The human output prints one `== apps/web/tailwind.config.ts (N files, K ghosts)` block per
  config followed by that config's report, then a `total:` line. `--json` switches to the
  multi-config document described under *Output example*; `--env` prints one block per config.
- **No cross-config de-duplication.** A shared file (`packages/ui/src/Button.tsx`) that several
  configs include is scanned by each of them, and a class that is a ghost for two configs is
  listed under both — that is the point: the same `text-sm` can be alive in `apps/web` and dead
  in `apps/admin`.
- Exit code `1` if **any** config has ghosts (subject to `--fail-on`); `2` if **any** config fails
  to load or scan — that config is reported as `{ config, error }`, the others are still analyzed,
  and stderr says how many failed. `--all-configs` that finds nothing is also exit `2`, naming the
  directory it searched. It skips `node_modules`, `dist`, `.next`, `build`, `out` and `coverage`.
- A base config that only exists to be extended by the apps (no `content` matching anything)
  fails with *No files matched* / *Nothing to scan*; pass `--allow-empty` or leave it out with an
  explicit `--config` list.

## Requirements & compatibility

tw-ghost drives **your project's own `tailwindcss`** through its public `loadConfig` /
`resolveConfig` entry points and PostCSS. Everything below follows from that.

### Support matrix

| Area | Status | Notes |
| --- | --- | --- |
| Tailwind CSS 3.3.x – 3.4.x | ✅ supported | Verified with 3.3.0 and 3.4.19 (3.4.x is what the fixtures use). Any later 3.x is accepted. |
| Tailwind CSS 3.0 – 3.2 | ❌ exit 2 | No `tailwindcss/loadConfig` before 3.3.0. Message: `found 3.2.7, need >=3.3.0`. |
| Tailwind CSS 4.x | ❌ exit 2 | CSS-first, no JS config, different generation model. tw-ghost is v3-only. |
| Tailwind CSS ≤ 2.x | ❌ exit 2 | Predates the entry points tw-ghost needs. |
| Node.js | ≥ 20 | CI runs 20 and 22; 24 is used in development. On Node ≥ 22.12 a `.ts` config inside a CommonJS package makes *Node* print one `Warning: Failed to load the ES module` line before Tailwind's loader takes over — harmless. |
| Config file | `tailwind.config.{ts,js,cjs,mjs}` | Auto-detected by walking up from cwd, or `--config`. CJS `module.exports`, ESM `export default`, TypeScript (`satisfies Config`, `import type`) via Tailwind's own jiti-based loader. `import.meta` in a config needs Tailwind ≥ 3.4.2 (or Node ≥ 22.12). A config that exports a **function** is rejected (Tailwind v3 does not support that either). |
| `content` | array or `{ files, relative, transform, extract }` | Only **string globs** are scanned, resolved from the config file's directory; `{ raw }` entries are ignored. `transform` / `extract` are **not applied** (warning). `relative: true` changes nothing for tw-ghost — that is already how it resolves. |
| Config features | `presets`, `plugins` (`addUtilities` / `addComponents` / `addVariant` / `matchUtilities`), `prefix`, `separator`, `important` (boolean or selector), `darkMode`, `safelist` (strings and `{ pattern }`), `corePlugins` (object or array), `theme` replace / `extend`, theme sections as functions (`({ theme }) => …`) | All honoured because your Tailwind resolves and runs the config; tw-ghost never reimplements them. Note that plugin-added classes get your `prefix` (Tailwind behaviour), and a safelisted class that is dead in your theme is still a ghost — the safelist only adds candidates, it cannot conjure CSS. |
| Frameworks | any | Next, Vite, CRA, Astro, SvelteKit, Nuxt, Remix … tw-ghost only reads the config and scans files; no build integration. |
| Monorepos | ✅ | `--config packages/web/tailwind.config.ts` from the root works; presets `require()`d from workspace packages resolve from the config file. `tailwindcss` is resolved **from the config file's directory upward** (hoisted root installs are fine). If that walk cannot reach it (strict layouts, config in a folder without `node_modules`), pass `--tailwind <dir>`. |
| Package manager | npm / pnpm / yarn | Irrelevant beyond Tailwind resolution above. |
| `postcss` | optional peer | Your project's `postcss` if resolvable from the config, otherwise the one `tailwindcss` depends on (verified with a layout where only `tailwindcss` is reachable). |
| `@config` in CSS (Tailwind ≥ 3.2) | not read | tw-ghost needs the config **file**; point `--config` at the same file your `@config` directive names. |
| Windows | untested | Globs are written in POSIX form and reported paths are normalised to `/`, but no Windows run has been verified. Reports welcome. |

### What is scanned / not scanned

- **Scanned:** every file the `content` string globs (or your positional globs) match, as raw
  text, line by line, with Tailwind's own default extractor. Any file kind works — `.tsx`, `.vue`,
  `.svelte`, `.astro`, `.mdx`, `.html`, `.css`, … — because the extractor is language-agnostic.
  String literals inside `clsx()`, `cva()`, `tv()` and template literals are seen the same way
  Tailwind sees them: as text.
- **`@apply` is not judged as CSS.** A `.css` file matched by your globs is scanned as text, so
  the class names after `@apply` become candidates like any other token; tw-ghost does not parse
  CSS or understand `@apply` semantics (Tailwind itself fails the build on `@apply` of a dead
  class, so these are rarely ghosts in a passing build).
- **Not seen:** class names assembled at runtime (`` `text-${size}` ``, concatenation) — invisible
  to Tailwind too; classes that only a `content.transform` / `content.extract` would produce;
  anything in files your globs do not match. Svelte's `class:z-20={…}` directive is extracted as
  the token `class:z-20` and judged by its bare utility, so a dead `z-20` is reported under that
  spelling.

### How it fails

Every condition below exits **2**, writes nothing on stdout, and prints one line on stderr
starting with `tw-ghost:` — so a mis-set-up run can never pass CI as "0 ghosts".

| Condition | Message starts with |
| --- | --- |
| Unknown flag / bad value | `tw-ghost: Unknown option …` / `tw-ghost: --max-locations must be …` / `tw-ghost: --fail-on must be …` |
| No config found | `tw-ghost: No tailwind.config.{ts,js,cjs,mjs} found walking up from <cwd>. Pass --config <path>.` |
| `--config` path missing | `tw-ghost: Config file not found: <path>` |
| `tailwindcss` not resolvable | `tw-ghost: Could not resolve "tailwindcss" from <dir>. Resolution starts at the config file's directory …` (suggests `--tailwind <dir>`) |
| `--tailwind` directory missing | `tw-ghost: --tailwind directory not found: <dir>` |
| Tailwind 4.x | `tw-ghost: Unsupported Tailwind CSS version: found 4.1.14, tw-ghost supports 3.3.x – 3.4.x only. Tailwind v4 is CSS-first … tw-ghost is v3-only.` |
| Tailwind ≤ 2.x | `tw-ghost: Unsupported Tailwind CSS version: found 2.2.19, tw-ghost supports 3.3.x – 3.4.x only. … upgrade to tailwindcss 3.3.0 or newer.` |
| Tailwind 3.0 – 3.2 | `tw-ghost: Unsupported Tailwind CSS version: found 3.2.7, need >=3.3.0. "tailwindcss/loadConfig" … was added in 3.3.0` |
| 3.3+ install without `loadConfig` / `resolveConfig` | `tw-ghost: tailwindcss <ver> at <dir> does not provide "tailwindcss/loadConfig" and "tailwindcss/resolveConfig"` |
| Config throws / `require()` fails | `tw-ghost: Failed to load <config>: <underlying message>` (no stack trace) |
| Config exports a function | `tw-ghost: <config> exports a function. Tailwind v3 expects a plain config object …` |
| Config exports null / a primitive | `tw-ghost: <config> did not export a config object (got …)` |
| `resolveConfig` throws | `tw-ghost: Failed to resolve <config> with tailwindcss/resolveConfig: …` |
| No string `content` globs and no positional globs | `tw-ghost: Nothing to scan: pass file globs on the command line or add string globs to the config's "content" (or pass --allow-empty).` |
| Globs match zero files | `tw-ghost: No files matched "<globs>" (resolved from <dir>). …` |
| Invalid `--ignore` regex | `tw-ghost: Invalid --ignore pattern …` |

Warnings do **not** change the exit code; each is printed once on stderr as
`tw-ghost: warning: …` and also listed in `report.warnings` (`--json`):

| Warning | When |
| --- | --- |
| `content.transform/content.extract are not applied; …` | The config has `content.transform` and/or `content.extract`. Classes produced only by a transform are not seen; classes a transform would remove are still judged. |
| `tailwindcss/lib/lib/defaultExtractor could not be loaded …; using tw-ghost's bundled copy` | Tailwind's internal extractor path is missing; `extractor` is `bundled` in the report. |

### `--env`: what to paste into a bug report

```
$ npx tw-ghost --env
tw-ghost     0.1.0
node         v22.11.0 (darwin-arm64)
cwd          /work/acme-web
config       /work/acme-web/tailwind.config.ts
tailwindcss  3.4.19  /work/acme-web/node_modules/tailwindcss
postcss      8.5.6  /work/acme-web/node_modules/postcss
extractor    project
content      2 globs (resolved from /work/acme-web)
               ./src/**/*.{ts,tsx}
               ./app/**/*.{ts,tsx}
content opts relative=false transform=false extract=false
prefix       ""
separator    ":"
important    false
darkMode     "class"
```

`--env` runs the same preflight as a normal run (config detection, `--config`, `--tailwind`) and
exits 2 with the same message when it fails, so it is also the quickest way to check whether your
project is supported. `--env --json` prints the same data as JSON, including `warnings`.

## CLI options

| Option | Default | Description |
| --- | --- | --- |
| `[globs...]` | config `content` globs | Files to scan. Positional globs are resolved from the current directory and replace the config's `content` list. |
| `-c, --config <path>` | walk up from cwd | `tailwind.config.{ts,js,cjs,mjs}` to load. Repeatable, and accepts globs (`'apps/*/tailwind.config.ts'`, `node_modules` skipped); a glob that matches nothing is exit `2`. More than one config → multi-config output (see *Monorepos*). |
| `--all-configs` | off | Analyze every `tailwind.config.{ts,js,cjs,mjs}` under cwd (skipping `node_modules`, `dist`, `.next`, `build`, `out`, `coverage`). Exit `2` when none is found. Can be combined with `--config`. |
| `--tailwind <dir>` | config's directory | Resolve `tailwindcss` (and `postcss`) from this directory instead of the config file's. For layouts where the config's folder cannot reach the install. The config file itself still loads from its own location. |
| `--env` | off | Print the resolved environment (config, `tailwindcss` version + path, `postcss`, extractor, content globs, warnings) and exit 0 — or exit 2 with the preflight error. Combine with `--json`. |
| `--format <human\|json\|github>` | `human` | Output format. `github` prints one `::error` [workflow-command annotation](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands#setting-an-error-message) per ghost **occurrence** (every location, `--max-locations` is ignored) plus a one-line summary on stderr; see *CI*. |
| `--json` | off | Alias for `--format json`: a machine-readable report on stdout. Unchanged. |
| `--max-annotations <n>` | `50` | `github` only: annotations printed before the rest are folded into one `::notice::tw-ghost: K more annotations omitted`; `0` = all. |
| `--unknown` | off | Also list the **utility-like** unknowns — classes that produce no CSS in stock *or* project but whose prefix is a Tailwind utility and whose value looks like one it could take (`text-mm`, `px-13`, `rounded-xll`; typos and dead tokens) — sorted by occurrence count, then name; plus classes whose utility works but whose variant chain this config does not know (`unknownVariant`). Identifiers that merely share a root (`my-page`, `no-op`, `bottom-start`) are not shown. |
| `--unknown-all` | off | With `--unknown`: list every raw unknown token instead of the utility-like subset (every word, identifier and URL the extractor saw — on a real app this is tens of thousands of lines). Same sort order. |
| `--max-locations <n>` | `3` | Locations kept per class; `0` = all. Must be a non-negative integer (`3abc` is rejected with exit 2). |
| `--ignore <regex>` | – | Skip classes whose name matches; repeatable. |
| `--allow-empty` | off | Exit `0` with an empty report when no file matches / nothing is configured to scan. Without it that is exit `2`, so a mistyped glob cannot silently pass CI. |
| `--fail-on <ghost\|none>` | `ghost` | What turns the exit code into `1`. |
| `--no-suggestions` | off | Skip the replacement search (faster on huge themes). |
| `--fix-map-init <file>` | – | Write a **fix-map draft** for the current ghosts and exit 0: one key per bare utility (variants stripped), value = the single suggestion, a list of candidates, or `null`. Refuses to overwrite an existing file. |
| `--fix-map <file>` | – | Apply a fix map (see *Fixing ghosts*): replace or remove every occurrence of each mapped ghost, carrying variants, `!` and `-` over. **Dry run** unless `--write`. Exit 1 when ghosts remain unmapped (`--fail-on none` → 0). |
| `--write` | off | With `--fix-map`: write the changed files. |
| `--no-color` | off | Disable ANSI colors (`NO_COLOR` is respected too). |
| `-h, --help` / `-v, --version` | | |

## Output example

Human (the `replaced-scale` fixture in this repository):

```
tw-ghost · tailwindcss 3.4.17 · /work/acme-web/tailwind.config.ts
scanned 2 files, 49 candidates (10 ok, 5 ghost, 0 unknown-variant, 34 unknown of which 1 utility-like) in 279ms

✖ 5 ghost classes — valid in stock Tailwind, produce no CSS in this config:

  text-sm  (4 occurrences)
    src/App.tsx:7:21
    src/App.tsx:8:88
    src/App.tsx:11:57
    … and 1 more location
    stock: font-size: 0.875rem; line-height: 1.25rem
    try:   text-l, text-m, text-s, text-xs

  -m-3  (1 occurrence)
    src/App.tsx:7:76
    stock: margin: -0.75rem
    try:   -m-2, -m-4, -m-0, -m-8, -m-16, -m-auto

  md:hover:text-sm  (1 occurrence)
    src/App.tsx:7:49
    stock: font-size: 0.875rem; line-height: 1.25rem
    try:   md:hover:text-l, md:hover:text-m, md:hover:text-s, md:hover:text-xs

  p-3  (1 occurrence)
    src/App.tsx:7:40
    stock: padding: 0.75rem
    try:   p-2, p-4, p-0, p-8, p-16
```

Note that `text-sm` has **4** occurrences although the file also contains `md:hover:text-sm`:
occurrences are whole tokens, so a candidate is never counted inside a longer class
(`md:text-sm`, `legacy-text-sm`, `p-30`, `!p-3`, `-p-3`, `p-3.5`, `text-sm/50`).

`--json` (shape is stable across patch releases; new keys may be added, none removed):

```json
{
  "version": "0.1.0",
  "configPath": "/work/acme-web/tailwind.config.ts",
  "tailwindVersion": "3.4.17",
  "extractor": "project",
  "warnings": [],
  "filesScanned": 2,
  "candidateCount": 49,
  "summary": { "ok": 10, "ghost": 5, "unknown": 34, "unknownVariant": 0, "unknownUtilityLike": 1 },
  "ghosts": [
    {
      "class": "text-sm",
      "count": 4,
      "locations": [{ "file": "src/App.tsx", "line": 7, "col": 21 }],
      "stockCss": ["font-size: 0.875rem", "line-height: 1.25rem"],
      "suggestions": ["text-l", "text-m", "text-s", "text-xs"]
    }
  ],
  "unknown": [],
  "unknownVariant": [],
  "durationMs": 279
}
```

The three `unknown*` counters in `summary` are always filled, even without `--unknown`:

- `summary.unknown` — raw count of every candidate that produced nothing anywhere. Most of these
  are ordinary words from your source (`import`, `className`, …), so the number is large and
  mostly meaningless on its own.
- `summary.unknownUtilityLike` — the subset that passes the utility-looking heuristic (see
  *Known sources of false negatives*). This is the number to watch in CI: it is what `--unknown`
  would list.
- `summary.unknownVariant` — candidates whose bare utility works in your config but whose variant
  chain does not (`bogus:p-4` when `p-4` is fine). Typically a typo in the variant.

The `unknown` and `unknownVariant` arrays are only filled with `--unknown`. `unknown` holds the
utility-like subset (`summary.unknownUtilityLike` entries) unless `--unknown-all` is also given,
in which case it holds every raw unknown (`summary.unknown` entries); both are sorted by `count`
descending, then `class`. The two summary counters are the same either way, so a consumer can
tell which list it got from `unknown.length`.

**Several configs** (`--all-configs`, or `--config` resolving to more than one file): the document
becomes `{ version, configs, summary, durationMs }`. Each `configs[]` entry is `{ config, …report }`
— `config` is the path relative to cwd, the rest is exactly the single-config report above minus
`version` — or `{ config, error }` for a config that failed. `summary` adds up the per-config
summaries and adds `configs` (entries), `failed`, `filesScanned` and `candidateCount`. With exactly
**one** config, however it was named (`--config a`, a glob matching one file, `--all-configs` finding
one), the output stays the single-config document above, byte for byte.

```json
{
  "version": "0.3.0",
  "configs": [
    {
      "config": "apps/admin/tailwind.config.js",
      "configPath": "/work/acme/apps/admin/tailwind.config.js",
      "tailwindVersion": "3.4.17",
      "extractor": "project",
      "warnings": [],
      "filesScanned": 2,
      "candidateCount": 27,
      "summary": { "ok": 4, "ghost": 2, "unknown": 21, "unknownVariant": 0, "unknownUtilityLike": 0 },
      "ghosts": [ … ],
      "unknown": [],
      "unknownVariant": [],
      "durationMs": 86
    },
    { "config": "apps/legacy/tailwind.config.js", "error": "Failed to load /work/acme/apps/legacy/tailwind.config.js: …" },
    { "config": "apps/web/tailwind.config.ts", … }
  ],
  "summary": {
    "configs": 3,
    "failed": 1,
    "filesScanned": 4,
    "candidateCount": 54,
    "ok": 8,
    "ghost": 4,
    "unknown": 42,
    "unknownVariant": 0,
    "unknownUtilityLike": 0
  },
  "durationMs": 270
}
```

## Fixing ghosts

tw-ghost does not guess replacements on its own: `text-sm` may mean `text-l` in one design system and
`text-m` in another, and that is a design decision, not a string match. Instead it turns the decision
into a small JSON file your team makes once and reuses across apps.

```sh
# 1. draft a map from the current ghosts
npx tw-ghost --fix-map-init fixes.json
```

```jsonc
// fixes.json (draft): keys are bare utilities — variants, "!" and "-" are handled for you
{
  "rounded":  ["rounded-0", "rounded-2", "rounded-4", "rounded-8"],   // several candidates: pick one
  "text-sm":  ["text-l", "text-m", "text-s"],
  "z-10":     "z-content-1",                                          // exactly one suggestion
  "min-w-px": null                                                    // no candidate: null = remove
}
```

Reduce every array to one string (or `null` to delete the class), then:

```sh
# 2. see what would change (nothing is written)
npx tw-ghost --fix-map fixes.json

# 3. apply
npx tw-ghost --fix-map fixes.json --write
```

Rules the fixer follows:

- **Whole tokens only.** `text-sm` is never touched inside `md:text-sm` (that one is handled through its own
  bare utility), `legacy-text-sm` or `text-sm/50`; `p-3` is never touched inside `p-30`, `p-3.5`, `!p-3`.
- **Variants, `!` and `-` are carried over.** `{ "mt-3": "mt-4" }` turns `lg:!-mt-3` into `lg:!-mt-4`.
  A custom `separator` is honoured.
- **Removal eats one space.** `class="a z-10 b"` → `class="a b"`; a class that was alone becomes `""` —
  review those in the dry run.
- **Nothing is inferred.** A ghost that is not in the map stays a ghost: the run still exits 1 and lists it
  under *unmapped*. Map entries that match nothing are listed under *unused*.
- **Only files that contain a mapped ghost are opened**, and only lines with a match are rewritten; line
  endings (LF / CRLF) are preserved.
- The fixer edits **text**, not a syntax tree. It is safe for class strings, template literals and
  `clsx`/`cva` calls, and it will also rewrite a matching token in a comment or a string that is not a
  class list — the dry run shows every edit with `file:line:col`, so read it before `--write`.

`--json` with `--fix-map` prints `{ "fix": { "write", "edits", "files", "unused", "unmapped" } }`.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | No ghosts (or `--fail-on none`), or an empty scan with `--allow-empty`. |
| `1` | At least one ghost class found. |
| `2` | Usage or configuration error: bad flag or value (e.g. non-integer `--max-locations`), no config found, config failed to load or exported a function, `tailwindcss` not resolvable, unsupported Tailwind version (4.x, ≤ 2.x, 3.0–3.2), **no file matched the globs / nothing to scan** (unless `--allow-empty`). With several configs: a `--config` glob or `--all-configs` that matches nothing, or **any** config failing (the others are still reported). Full list with messages under *How it fails*. |

| `1` | At least one ghost class found; with `--fix-map`, at least one ghost left unmapped. |
| `2` | Usage or configuration error: bad flag or value (e.g. non-integer `--max-locations`), no config found, config failed to load or exported a function, `tailwindcss` not resolvable, unsupported Tailwind version (4.x, ≤ 2.x, 3.0–3.2), **no file matched the globs / nothing to scan** (unless `--allow-empty`). Full list with messages under *How it fails*. |

## Programmatic API

```ts
import { analyze, formatHuman } from 'tw-ghost';

const report = await analyze({
  cwd: process.cwd(),          // base for auto-detection, globs and relative paths
  config: 'tailwind.config.ts', // optional
  globs: ['src/**/*.tsx'],      // optional, defaults to the config's content globs
  ignore: [/^legacy-/],
  unknown: false,
  unknownAll: false,            // with unknown: raw list instead of the utility-like subset
  allowEmpty: false,            // true → empty report instead of TwGhostConfigError
  maxLocations: 3,
  suggestions: true,
  tailwind: undefined,          // optional, like --tailwind <dir>
});

for (const warning of report.warnings) console.warn(warning);
console.log(formatHuman(report, { color: false }));
process.exitCode = report.ghosts.length > 0 ? 1 : 0;
```

`analyze()` throws `TwGhostConfigError` for the situations that map to exit code 2.

Several configs at once — what the CLI does for `--all-configs` / repeated `--config`:

```ts
import { analyzeMany, formatHumanMany, isConfigFailure, resolveConfigPaths } from 'tw-ghost';

const configs = await resolveConfigPaths({ cwd, all: true }); // or { configs: ['apps/*/tailwind.config.ts'] }
const multi = await analyzeMany(configs, { cwd, ignore: [/^legacy-/] }); // same options as analyze(), minus `config`
for (const entry of multi.configs) {
  if (isConfigFailure(entry)) console.error(entry.config, entry.error); // that config threw; the rest ran
}
console.log(formatHumanMany(multi, { color: false }));
process.exitCode = multi.summary.failed > 0 ? 2 : multi.summary.ghost > 0 ? 1 : 0;
```

`analyzeMany()` never throws for a single bad config — it records `{ config, error }` and moves on
— but `resolveConfigPaths()` throws `TwGhostConfigError` when a glob matches nothing or discovery
finds no config. `analyze()` is unchanged.
`describeEnvironment({ cwd, config, tailwind })` returns what `--env` prints. Lower-level
pieces are exported too: `loadProject`, `findConfig`, `assertSupportedTailwind`, `classify`, `splitVariants`,
`looksUtilityLike`, `scanContent`, `unescapeCssIdentifier`, `stockConfigFrom`, `collectClasses`,
`changedThemeKeys`. Both ESM (`import`) and CommonJS (`require`) builds ship with their own type
definitions (`dist/index.d.ts` for `import`, `dist/index.d.cts` for `require`, selected per
`exports` condition).

## How it works

1. **Load the project's Tailwind.** `tailwindcss`, `tailwindcss/loadConfig` (jiti handles `.ts`),
   `tailwindcss/resolveConfig` and `postcss` are resolved with `createRequire(configPath)` (or
   from `--tailwind <dir>`), so the exact version your build uses is the one that judges. A
   version outside 3.3–3.4 → exit 2 before anything is loaded (see *Requirements & compatibility*).
2. **Pick files.** Positional globs (relative to cwd) or, by default, the string entries of the
   config's `content` (objects with `raw` are ignored). `node_modules`, `dist`, `.next`, `.git`
   are always skipped; `!negated` globs are honoured. An input set that resolves to zero files
   is an error (exit 2) unless `--allow-empty` is given.
   *Design choice:* `content` globs are resolved relative to the **config file's directory**, not
   the process cwd. Tailwind itself resolves them from cwd unless `content.relative` is set, but
   the config-directory reading is what nearly every project intends and it makes
   `--config apps/x/tailwind.config.ts` from a monorepo root work.
3. **Extract candidates** line by line with the project's own
   `tailwindcss/lib/lib/defaultExtractor` (a bundled copy of the v3 extractor is the fallback if
   that internal path ever disappears — the report's `extractor` field tells you which ran).
   Each candidate keeps every `file:line:col` where it appears **as a whole token** (the
   characters around it are not class-token characters); candidates are deduplicated globally.
4. **Generate CSS twice** through PostCSS with the input `@tailwind components; @tailwind utilities;`
   and `content: [{ raw: candidates.join('\n'), extension: 'html' }]`:
   - **project run** — your config as loaded (theme, presets, plugins, safelist, `corePlugins`, …);
   - **stock run** — only your `prefix` / `separator` / `important` / `darkMode` on top of the
     default theme, with **`theme.screens` = default screens merged with yours**, and no plugins,
     presets or safelist. That way `tablet:text-sm` (custom breakpoint) resolves in the stock run
     directly, and so does `2xl:p-4` after you replaced `screens` without `2xl` — a ghost by CSS
     output, since stock Tailwind emits it and your config does not.
   Both runs also receive the **bare utility** of every variant-bearing candidate
   (`hocus:text-sm` → `text-sm`) so step 5 can fall back to it.
   Every rule selector is parsed with `postcss-selector-parser`; class nodes are unescaped
   (`md\:hover\:text-sm` → `md:hover:text-sm`, `\2c ` → `,`) and collected as a set, together
   with the declarations of the rule they came from. Tailwind's own
   `warn - No utility classes were detected` message — which it prints whenever a run emits
   nothing, i.e. the normal case for tw-ghost — is filtered out of stderr during these runs; every
   other Tailwind warning still gets through.
5. **Classify** each candidate:
   - in the project set → `ok`;
   - only in the stock set → **ghost**;
   - in neither set and it carries a variant chain (split on the config's `separator`, at bracket
     depth 0 only, so `[&_svg]:fill-current` and `bg-[url(data:image/png;base64,x)]` split
     correctly) → judged by its **bare utility**: utility in stock and not in project → **ghost**
     (`tablet:text-sm`, `hocus:text-sm`, `dark:md:hover:text-sm` when `text-sm` is dead); utility
     in project → `unknown-variant`;
   - otherwise → `unknown`.
   The chain must look like a real variant chain (`md:`, `group-hover/edit:`, `data-[state="open"]:`,
   `supports-[display:grid]:`); extractor noise such as `class="tablet:text-sm` is left `unknown`.
6. **Suggest replacements** (best effort, opt-out with `--no-suggestions`). For each ghost root
   (`text`, `p`, `z`, …) tw-ghost generates `root-<key>` for every key of every theme section whose
   key set differs from stock, then keeps the ones that set at least one real CSS property
   (custom `--tw-*` properties ignored) in common with the ghost's stock output. Numeric keys are
   ordered by distance to the ghost's key; at most 8 are shown. Variants (split on the configured
   `separator`), `!` and the negative `-` are re-attached to the suggestion.

### Design choices

Decisions that shape what gets reported, stated plainly so you can judge whether they fit your
project:

- **A ghost is defined by CSS output, not by the config shape.** If stock Tailwind emits CSS for a
  class and your config does not, it is a ghost — whatever the reason (replaced scale, dropped
  key, disabled core plugin, `prefix`).
- **A variant-bearing class that resolves nowhere is judged by its bare utility.** The stock run
  cannot know your `addVariant('hocus', …)` plugin or a custom screen, so `hocus:text-sm` would
  otherwise be lost as `unknown`. Bare utility dead in your config → ghost; bare utility alive →
  `unknown-variant` (listed only with `--unknown`, counted separately in `summary`). The stock run
  additionally uses the default screens merged with the project's, so a custom breakpoint
  resolves there (`tablet:text-sm` → ghost) and a removed stock breakpoint stays a ghost
  (`2xl:p-4` with `2xl` gone → ghost, not `unknown-variant`).
- **Variants are split on the configured `separator`** (default `:`), only at bracket depth 0.
  This applies to classification, suggestions and the `--unknown` heuristic alike; with
  `separator: '_'`, `md_hover_tw-text-sm` is a ghost and `md:hover:tw-text-sm` is just an
  unknown word.
- **Occurrences are whole tokens.** `text-sm` is not counted inside `md:text-sm`, `legacy-text-sm`
  or `text-sm/50`, and `p-3` is not counted inside `p-30`, `!p-3`, `-p-3` or `p-3.5`. Counts drive
  the sort order and the headline, so they must be honest.
- **An empty input set is an error, not a pass.** Zero files (or a config without string
  `content` globs) exits 2 with a message that says what was searched and where. `--allow-empty`
  restores exit 0 for the rare case where that is intended.
- **Strict option parsing.** `--max-locations` must be a non-negative integer; `3abc` is rejected
  instead of being read as `3`.
- **Preflight fails loudly, degradation warns.** Anything that would make the comparison
  meaningless (unsupported Tailwind, unreachable install, unloadable config) is exit 2 with a
  message that names what was found. Anything tw-ghost can still run *around* but not reproduce
  (`content.transform` / `extract`, the bundled extractor fallback) is a one-line stderr warning
  plus `report.warnings`, never a silent difference.
- **Tailwind's "No utility classes were detected" warning is suppressed** during tw-ghost's own
  generation runs. It says nothing about your build and would otherwise appear on every run
  where all candidates are ghosts. Only that message is filtered.
- **Both unknown counters are reported.** `summary.unknown` stays the raw count so the JSON shape
  is stable; `summary.unknownUtilityLike` is the meaningful number for CI. Neither requires
  `--unknown`.
- **Packaging.** `exports` declares per-condition types (`import` → `.d.ts`, `require` → `.d.cts`)
  so CommonJS TypeScript consumers do not get ESM typings; `bin` is `dist/cli.js`;
  `publishConfig.registry` pins the public npm registry so a local `npm publish` can never land
  in a private registry by accident; `postcss` is an optional peer.

### Known sources of false positives

- **A class you intentionally never want CSS for** but that exists in stock Tailwind — e.g. a
  hook name like `container` handled by your own CSS. Use `--ignore`.
- **`unknownVariant` can contain inline-CSS tokens.** With `--unknown`, a `property:value` pair
  the extractor picks out of a `style="display:flex"` attribute or a CSS-in-JS string looks like a
  variant chain (`display:`) over a live utility (`flex`), so it is listed as `unknown-variant`.
  It never affects the ghost list or the exit code; `--ignore "^(display|position|overflow):"`
  hides it.
- **A dead utility under a variant that does not exist at all.** `bogus:text-sm` is reported as a
  ghost when `text-sm` is dead, because the bare-utility fallback cannot tell a project-only
  variant from a typo. The utility *is* dead either way, so the report is still actionable, but
  the fix may be the variant rather than the utility.
- **`content.transform` / `content.extract`** in your config are not applied: tw-ghost scans raw
  file text and prints a warning once per run. If your transform *introduces* class names that
  are not literally in the source, those are not seen (a false negative); if it *removes* text,
  tw-ghost may report classes your build never sees.
- **Theme values that are functions of runtime state** (rare) resolve identically in both runs,
  so they are not an issue — but plugins that emit utilities conditionally on `content` may differ.

### Known sources of false negatives

- **Dynamic class construction** (`` `text-${size}` ``, string concatenation) — invisible to
  Tailwind and to tw-ghost alike.
- **Safelisted classes** produce CSS in the project run and are therefore `ok`, even if they only
  work because of the safelist.
- **Classes that only differ in value, not existence.** If your theme *keeps* the key `4` but maps
  it to `4px` instead of `1rem`, `p-4` produces CSS and is correctly `ok` — tw-ghost checks
  existence, not intent.
- **A dead utility with a modifier** (`text-sm/6`, `bg-red-500/50`) resolves nowhere in either
  run and has no variant chain to fall back from, so it is `unknown`, not ghost. Use `--unknown`
  to see it.
- **Extractor noise is never judged by its bare utility.** A token such as `class="tablet:text-sm`
  (quote included) stays `unknown`; the real `tablet:text-sm` next to it is still reported.
- **Unknown-list heuristic.** `--unknown` keeps a candidate only if, after splitting off a
  plausible variant chain and the project `prefix`, it is shaped like a class (lowercase, digits,
  `-` `.` `/` `%`, balanced `[...]` without a `${` hole; no punctuation tail such as `px-16)` or
  `text-black,`), it does not start with `data-`/`aria-`/URL schemes, does not end with `-` or
  the separator (template-literal stubs such as `max-h-${x}`), its **prefix** is a value-taking
  core utility (`text`, `min-h`, `rounded-tl`, … — longest match) or a root the generated CSS
  proved to exist (custom plugins), and its **value** looks like one that utility could take:
  numeric / fraction / `[arbitrary]`, a generic keyword (`auto`, `full`, `none`, `px`,
  `screen`, …), a key of the theme sections that utility reads (project *and* stock — `text` reads
  `fontSize` + `textColor`), a keyword of that utility (`flex-col`, `justify-between`), a value
  observed in the generated CSS, one edit away from any of those (`xll` → `xl`, `mm` → `m`), or the
  head of a nested key (`red` when `red-500` exists). A `/modifier` must be numeric, arbitrary or
  an `opacity` / `lineHeight` key. Everything else is filtered out along with ordinary words —
  including a dead token whose value is nowhere near a real one (`text-danger` with no `danger*`
  color, `items-between`, `pb-safe` from a plugin that was never used correctly), a bare prefix
  (`max-h`, `space-y`) and a typo in the prefix itself (`tetx-sm`). Ambiguities were resolved
  towards fewer false positives; `--unknown-all` is the escape hatch.

### Known sources of noise in `--unknown`

What still gets through the utility-like filter, measured on a large real-world app (≈93,000 raw
unknowns → 20 listed, of which roughly two thirds were genuine typos or dead tokens):

- **Numeric values that are not classes.** `bg-0` next to a `bg-0.png` asset, `content-1`,
  `to-1`, `z-1` from prose or test data: a Tailwind prefix followed by a number is always
  accepted, because that is exactly what a dead scale key looks like (`mt-15`, `gap-125`).
- **Dead design-token names.** `hover:bg-surface-secondary`, `fill-on-color-pressed` when the
  token was renamed or removed: correctly listed, but the fix is usually in the theme, not the
  class.
- **Generic keywords on the wrong utility.** `peer-focus:ring-full`, `content-auto`: `full` /
  `auto` are accepted for every prefix.
- **Inline CSS and prose** only reach `unknownVariant` (`display:flex`, see *false positives*),
  never the utility-like list — but a class glued to a sentence in a comment (`px-16),`) is
  dropped by the shape check rather than reported, so the raw list (`--unknown-all`) is the place
  to look for those.

## Roadmap

- SARIF output.
- Per-file `// tw-ghost-ignore` comments.
- `--fix-map` scoped to a path (fix one app of a monorepo with a shared map).
- Proper `@apply` handling in CSS files (today they are scanned as plain text when your globs
  include them).
- Cache candidate extraction between runs for very large monorepos.
- Tailwind v4 support if a comparable "generate and compare" path becomes available.

## Development & release

```sh
pnpm install
pnpm build        # tsup → dist/ (ESM + CJS library, ESM CLI with shebang)
pnpm test         # builds first, then vitest (unit + fixture + CLI e2e)
pnpm lint         # biome check .   (pnpm lint:fix to apply)
pnpm typecheck    # tsc --noEmit
pnpm pack:check   # npm pack --dry-run — verify the tarball contents
```

Fixtures live in `test/fixtures/` (`replaced-scale`, `prefix`, `clean`, `variants`, `separator`,
`count`, `no-content`, `content-transform`), each with its own `tailwind.config.*` that resolves
the repository's dev `tailwindcss` 3.4.x. Version preflight tests (`test/preflight.test.ts`)
build throwaway projects with a fake `node_modules/tailwindcss/package.json` instead.

**Release:** publishing happens **only** through the tag → GitHub Actions flow. Never run
`npm publish` locally — `prepublishOnly` and `publishConfig.registry` are safety nets, not the
process. Bump `version` in `package.json` and `CHANGELOG.md`, commit, then

```sh
git tag vX.Y.Z
git push origin vX.Y.Z
```

The `Release` GitHub Action (`.github/workflows/release.yml`) installs, builds, tests and runs
`npm publish --provenance --access public` against `https://registry.npmjs.org/` with npm **trusted publishing**: the workflow
authenticates through its GitHub OIDC identity, so no npm token is stored anywhere. `v*` tags are protected by a repository ruleset: only the repository
admin can create them, so a collaborator's write access cannot trigger a release.

## License

MIT
