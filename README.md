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

- Replace an ESLint rule. [eslint-plugin-tailwindcss](https://github.com/francoismassart/eslint-plugin-tailwindcss)
  (`no-custom-classname`) and [eslint-plugin-better-tailwindcss](https://github.com/schoero/eslint-plugin-better-tailwindcss)
  (`no-unknown-classes`) give you editor feedback while typing. They are ESLint-bound and infer
  validity from the config; tw-ghost is linter-independent (works for Biome / oxlint teams) and
  judges by actual CSS output. Use both if you can.
- Detect classes built dynamically at runtime (`` `text-${size}` ``). Tailwind cannot see those
  either — they are broken in production already, not just in this report.
- Support Tailwind v4 (CSS-first config, no `tailwind.config.js`). It exits with code 2 and a message.
- Report "unknown" classes (custom CSS, plain words, typos) by default — see `--unknown`.

## Install & usage

```sh
# run in the directory that owns tailwind.config.* (auto-detected by walking up)
npx tw-ghost

# explicit config + explicit globs
npx tw-ghost "src/**/*.{ts,tsx}" --config apps/web/tailwind.config.ts

# CI: machine-readable, ignore a legacy prefix, also list typos and unknown variants
npx tw-ghost --json --ignore "^legacy-" --unknown
```

Requires Node ≥ 20 and `tailwindcss` ^3.3 installed in the target project (peer dependency).
`postcss` ^8 is an *optional* peer: tw-ghost uses the project's `postcss` when one is installed
next to the config and otherwise falls back to the `postcss` that `tailwindcss` itself depends on,
so a plain `tailwindcss` install is enough.

## CLI options

| Option | Default | Description |
| --- | --- | --- |
| `[globs...]` | config `content` globs | Files to scan. Positional globs are resolved from the current directory and replace the config's `content` list. |
| `-c, --config <path>` | walk up from cwd | `tailwind.config.{ts,js,cjs,mjs}` to load. |
| `--json` | off | Print a machine-readable report on stdout. |
| `--unknown` | off | Also list utility-looking classes that produce no CSS in stock *or* project (typo detection), and classes whose utility works but whose variant chain this config does not know (`unknownVariant`). |
| `--max-locations <n>` | `3` | Locations kept per class; `0` = all. Must be a non-negative integer (`3abc` is rejected with exit 2). |
| `--ignore <regex>` | – | Skip classes whose name matches; repeatable. |
| `--allow-empty` | off | Exit `0` with an empty report when no file matches / nothing is configured to scan. Without it that is exit `2`, so a mistyped glob cannot silently pass CI. |
| `--fail-on <ghost\|none>` | `ghost` | What turns the exit code into `1`. |
| `--no-suggestions` | off | Skip the replacement search (faster on huge themes). |
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

The `unknown` and `unknownVariant` arrays are only filled with `--unknown`; `unknown` is filtered
to utility-looking names.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | No ghosts (or `--fail-on none`), or an empty scan with `--allow-empty`. |
| `1` | At least one ghost class found. |
| `2` | Usage or configuration error: bad flag or value (e.g. non-integer `--max-locations`), no config found, config failed to load, `tailwindcss` not resolvable, Tailwind v4, **no file matched the globs / nothing to scan** (unless `--allow-empty`). |

## Programmatic API

```ts
import { analyze, formatHuman } from 'tw-ghost';

const report = await analyze({
  cwd: process.cwd(),          // base for auto-detection, globs and relative paths
  config: 'tailwind.config.ts', // optional
  globs: ['src/**/*.tsx'],      // optional, defaults to the config's content globs
  ignore: [/^legacy-/],
  unknown: false,
  allowEmpty: false,            // true → empty report instead of TwGhostConfigError
  maxLocations: 3,
  suggestions: true,
});

console.log(formatHuman(report, { color: false }));
process.exitCode = report.ghosts.length > 0 ? 1 : 0;
```

`analyze()` throws `TwGhostConfigError` for the situations that map to exit code 2. Lower-level
pieces are exported too: `loadProject`, `findConfig`, `classify`, `splitVariants`,
`looksUtilityLike`, `scanContent`, `unescapeCssIdentifier`, `stockConfigFrom`, `collectClasses`,
`changedThemeKeys`. Both ESM (`import`) and CommonJS (`require`) builds ship with their own type
definitions (`dist/index.d.ts` for `import`, `dist/index.d.cts` for `require`, selected per
`exports` condition).

## How it works

1. **Load the project's Tailwind.** `tailwindcss`, `tailwindcss/loadConfig` (jiti handles `.ts`),
   `tailwindcss/resolveConfig` and `postcss` are resolved with `createRequire(configPath)`, so the
   exact version your build uses is the one that judges. Major version ≠ 3 → exit 2.
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
  file text. If your transform *introduces* class names that are not literally in the source,
  those are not seen (a false negative); if it *removes* text, tw-ghost may report classes your
  build never sees.
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
  plausible variant chain, the utility matches `/^!?-?[a-z][a-z0-9-]*-[^\s]+$/` (or, under a
  variant chain, `/^!?-?[a-z][^\s]*$/`), it does not start with `data-`/`aria-`/URL schemes, does
  not end with `-` or the separator (template-literal stubs such as `max-h-${x}`), and its root
  (`text` in `text-smm`) is a core Tailwind utility root or one observed in the generated CSS.
  Custom plugin utilities that were never used correctly anywhere are filtered out along with
  ordinary words. Ambiguities were resolved towards fewer false positives.

## Roadmap

- `--format github` (workflow annotations) and SARIF output.
- Per-file `// tw-ghost-ignore` comments.
- Optional check of `@apply` inside CSS files.
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
`count`, `no-content`), each with its own `tailwind.config.*` that resolves the repository's dev
`tailwindcss` 3.4.x.

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
