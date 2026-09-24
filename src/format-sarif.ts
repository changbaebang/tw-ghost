import path from 'node:path';
import type { Finding, GhostFinding, Report } from './analyze.js';
import type { Location } from './extract.js';
// Same relativization as `--format github`: workspace-relative when the file lives under
// GITHUB_WORKSPACE, else cwd-relative. Reused so both CI formats agree on every path.
import { relativizeFile } from './format-github.js';
import { type ConfigReport, isConfigFailure, type MultiReport } from './multi.js';
import { VERSION } from './version.js';

/**
 * SARIF 2.1.0 output (`--format sarif`), for upload to GitHub Code Scanning via
 * `github/codeql-action/upload-sarif`.
 *
 * One `result` per **occurrence** — SARIF is consumed by a viewer that does its own grouping and
 * paging, so there is no display cap here: `--max-annotations` is a `--format github` concern and
 * is ignored. The CLI therefore runs the analysis with `maxLocations: 0`.
 *
 * Only the subset of the schema tw-ghost actually emits is typed below; every property matches
 * https://json.schemastore.org/sarif-2.1.0.json (which sets `additionalProperties: false` on
 * `sarifLog`, `run`, `result`, `toolComponent`, `reportingDescriptor`, … — so no extra keys).
 */

/** `reportingConfiguration.level` / `result.level` — the schema's four-value enum. */
export type SarifLevel = 'none' | 'note' | 'warning' | 'error';

export interface SarifMultiformatMessageString {
  /** Required by the schema even when `markdown` is present. */
  text: string;
  markdown?: string;
}

export interface SarifRule {
  id: string;
  name: string;
  shortDescription: { text: string };
  fullDescription: { text: string };
  help: SarifMultiformatMessageString;
  defaultConfiguration: { level: SarifLevel };
  properties: { tags: string[] };
}

export interface SarifArtifactLocation {
  /** Repo-relative, POSIX separators, percent-encoded per path segment. */
  uri: string;
  uriBaseId: string;
}

export interface SarifRegion {
  /** 1-based. */
  startLine: number;
  /** 1-based. */
  startColumn: number;
  /** The column *after* the class — `startColumn + class.length`. */
  endColumn: number;
}

export interface SarifPhysicalLocation {
  artifactLocation: SarifArtifactLocation;
  region: SarifRegion;
}

export interface SarifLocation {
  physicalLocation: SarifPhysicalLocation;
}

export interface SarifResult {
  ruleId: string;
  /** Index into `tool.driver.rules`. */
  ruleIndex: number;
  level: SarifLevel;
  message: { text: string };
  locations: SarifLocation[];
}

export interface SarifToolDriver {
  name: string;
  version: string;
  semanticVersion: string;
  informationUri: string;
  rules: SarifRule[];
}

export interface SarifRun {
  tool: { driver: SarifToolDriver };
  /** Only set when the log holds several runs (see {@link formatSarifMany}). */
  automationDetails?: { id: string };
  /** `startColumn` / `endColumn` count UTF-16 code units, as JavaScript string indices do. */
  columnKind: 'utf16CodeUnits';
  results: SarifResult[];
}

export interface SarifLog {
  $schema: string;
  version: '2.1.0';
  runs: SarifRun[];
}

export interface SarifFormatOptions {
  /** Base the report's relative paths resolve against. Default: process.cwd(). */
  cwd?: string | undefined;
  /**
   * Repository root the `uri` should be relative to. Default: `GITHUB_WORKSPACE`.
   * Files outside it (or when unset) stay relative to `cwd`.
   */
  workspace?: string | undefined;
  /**
   * The run was made with `--unknown`, so the two `note` rules are declared (and their findings
   * reported). Default: false — a run that cannot produce them does not advertise them.
   */
  unknown?: boolean | undefined;
  /** `tool.driver.version` / `semanticVersion`. Default: the tw-ghost package version. */
  version?: string | undefined;
  /**
   * `run.automationDetails.id`. Left out by default: `upload-sarif` fills a missing
   * `automationDetails` from its own `category:` input, so the single-run case stays the user's
   * to name.
   */
  automationId?: string | undefined;
}

export interface SarifFormatResult {
  log: SarifLog;
  /** One line for stderr — stdout is usually redirected into a `.sarif` file. */
  summary: string;
}

export const SARIF_SCHEMA_URI = 'https://json.schemastore.org/sarif-2.1.0.json';
export const SARIF_VERSION = '2.1.0';
/** GitHub resolves relative `uri`s against the repository root under this symbol. */
export const SARIF_URI_BASE_ID = '%SRCROOT%';
/** Suggestions listed in `message.text` before the rest are counted off. */
export const SARIF_MAX_SUGGESTIONS = 3;

export const SARIF_TOOL_NAME = 'tw-ghost';
const TOOL_INFORMATION_URI = 'https://github.com/changbaebang/tw-ghost#readme';

export const GHOST_RULE_ID = 'ghost-class';
export const UNKNOWN_UTILITY_RULE_ID = 'unknown-utility-like';
export const UNKNOWN_VARIANT_RULE_ID = 'unknown-variant';

/**
 * The rules a run can produce. `--unknown` off means the two `note` rules are never reached, so
 * they are not declared either: the log advertises exactly this run's vocabulary. (The schema
 * would also allow declaring unused rules — this is a choice, not a constraint.)
 *
 * Fresh objects every call: the returned rules end up inside the caller's log, which callers may
 * post-process.
 */
export function sarifRules(unknown = false): SarifRule[] {
  const rules: SarifRule[] = [
    {
      id: GHOST_RULE_ID,
      name: 'GhostClass',
      shortDescription: { text: 'Tailwind class that produces no CSS in this config' },
      fullDescription: {
        text: "The class is a valid stock Tailwind utility, but this project's config replaced (rather than extended) the theme scale it reads, renamed its key, or added a prefix — so Tailwind emits no rule for it and the styling silently does nothing.",
      },
      help: {
        text: 'Replace the class with one the project config does emit, or restore the missing theme key. `tw-ghost --format human` prints the declarations stock Tailwind would have set and the project classes that set the same properties; `tw-ghost --fix-map-init map.json` drafts a replacement map to decide once and apply everywhere.',
        markdown:
          '**A class that reads like Tailwind but generates nothing.** The utility exists in stock Tailwind, so it survives review and type-checking, but this project replaced the theme scale it reads (e.g. `theme.fontSize` instead of `theme.extend.fontSize`), renamed the key, or set a `prefix` — so no CSS rule is emitted and the element is simply unstyled.\n\n**How to fix**\n\n1. Run `npx tw-ghost` to see the declarations stock Tailwind would have set and the project classes that set the same properties.\n2. Replace the class with one of those, or add the missing key back to the theme.\n3. For a repo-wide sweep: `npx tw-ghost --fix-map-init map.json`, decide each replacement once, then `npx tw-ghost --fix-map map.json --write`.',
      },
      defaultConfiguration: { level: 'error' },
      properties: { tags: ['tailwindcss', 'dead-code'] },
    },
  ];
  if (!unknown) return rules;
  rules.push(
    {
      id: UNKNOWN_UTILITY_RULE_ID,
      name: 'UnknownUtilityLike',
      shortDescription: { text: 'Utility-like class that produces no CSS anywhere' },
      fullDescription: {
        text: 'The class looks like a Tailwind utility (a known utility root, or one edit away from one) but produces no CSS in this config and none in stock Tailwind either — usually a typo or a token that was removed, occasionally a class that comes from hand-written CSS.',
      },
      help: {
        text: 'Check the spelling against the utility roots the project does emit. If the class is styled by hand-written CSS or a plugin tw-ghost cannot see, exclude it with --ignore "<regex>".',
        markdown:
          '**Looks like a utility, is not one.** Neither this config nor stock Tailwind emits anything for it, so it is a typo (`text-smm`), a token that was deleted, or a class styled by hand-written CSS.\n\n**How to fix**\n\n- Fix the spelling, or delete the class if it is dead.\n- Genuinely styled elsewhere (custom CSS, a plugin tw-ghost cannot see)? Exclude it: `npx tw-ghost --unknown --ignore "^my-prefix-"`.\n\nReported only with `--unknown`, at `note` level: this check is a heuristic and is not meant to fail a build.',
      },
      defaultConfiguration: { level: 'note' },
      properties: { tags: ['tailwindcss', 'dead-code', 'typo'] },
    },
    {
      id: UNKNOWN_VARIANT_RULE_ID,
      name: 'UnknownVariant',
      shortDescription: { text: 'Known utility behind a variant chain this config does not know' },
      fullDescription: {
        text: 'The bare utility produces CSS in this config, but the variant chain in front of it does not resolve — a removed breakpoint, a misspelled or plugin-provided variant — so the whole class emits nothing.',
      },
      help: {
        text: 'Check each variant in the chain against the config: screens, custom variants and plugin variants. A variant that only exists in a Tailwind plugin tw-ghost cannot load can be excluded with --ignore "<regex>".',
        markdown:
          '**The utility is fine; the variant in front of it is not.** `md:text-m` emits nothing if `md` was dropped from `theme.screens`, and `hocus:text-m` emits nothing unless a plugin defines `hocus`.\n\n**How to fix**\n\n- Check every variant in the chain against `theme.screens` and the config\'s custom/plugin variants.\n- Provided by a plugin tw-ghost cannot load? Exclude it: `--ignore "^hocus:"`.\n\nReported only with `--unknown`, at `note` level.',
      },
      defaultConfiguration: { level: 'note' },
      properties: { tags: ['tailwindcss', 'dead-code', 'variant'] },
    },
  );
  return rules;
}

/** Percent-encode a POSIX path for `artifactLocation.uri`, keeping `/` as the separator. */
export const encodeUriPath = (posixPath: string): string =>
  posixPath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');

function ghostMessage(g: GhostFinding): string {
  const stock = g.stockCss.length > 0 ? ` (stock Tailwind: ${g.stockCss.join('; ')})` : '';
  const shown = g.suggestions.slice(0, SARIF_MAX_SUGGESTIONS);
  if (shown.length === 0) return `${g.class} produces no CSS in this Tailwind config${stock}`;
  const rest = g.suggestions.length - shown.length;
  const more = rest > 0 ? ` (+${rest} more)` : '';
  return `${g.class} produces no CSS in this Tailwind config${stock} — try: ${shown.join(', ')}${more}`;
}

function buildRun(report: Report, rules: SarifRule[], options: SarifFormatOptions): SarifRun {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const workspace = options.workspace ?? process.env.GITHUB_WORKSPACE;
  const version = options.version ?? VERSION;
  const declared = new Map(
    rules.map((rule, index) => [rule.id, { index, level: rule.defaultConfiguration.level }]),
  );
  const results: SarifResult[] = [];
  const add = (ruleId: string, finding: Finding, message: string): void => {
    const rule = declared.get(ruleId);
    if (rule === undefined) return; // this run does not declare the rule, so it reports nothing
    for (const loc of finding.locations) results.push(result(ruleId, rule, finding, loc, message));
  };
  const result = (
    ruleId: string,
    rule: { index: number; level: SarifLevel },
    finding: Finding,
    loc: Location,
    message: string,
  ): SarifResult => ({
    ruleId,
    ruleIndex: rule.index,
    level: rule.level,
    message: { text: message },
    locations: [
      {
        physicalLocation: {
          artifactLocation: {
            uri: encodeUriPath(relativizeFile(loc.file, cwd, workspace)),
            uriBaseId: SARIF_URI_BASE_ID,
          },
          region: {
            startLine: loc.line,
            startColumn: loc.col,
            endColumn: loc.col + finding.class.length,
          },
        },
      },
    ],
  });

  for (const g of report.ghosts) add(GHOST_RULE_ID, g, ghostMessage(g));
  for (const u of report.unknown) {
    add(
      UNKNOWN_UTILITY_RULE_ID,
      u,
      `${u.class} produces no CSS in stock Tailwind or this config (typo or custom CSS?)`,
    );
  }
  for (const u of report.unknownVariant) {
    add(
      UNKNOWN_VARIANT_RULE_ID,
      u,
      `${u.class}: the utility works in this config but its variant chain is unknown`,
    );
  }

  const automation =
    options.automationId === undefined ? {} : { automationDetails: { id: options.automationId } };
  return {
    tool: {
      driver: {
        name: SARIF_TOOL_NAME,
        version,
        semanticVersion: version,
        informationUri: TOOL_INFORMATION_URI,
        rules,
      },
    },
    ...automation,
    columnKind: 'utf16CodeUnits',
    results,
  };
}

const plural = (n: number, word: string, many = `${word}s`): string =>
  `${n} ${n === 1 ? word : many}`;

const occurrencesOf = (report: Report): number => report.ghosts.reduce((n, g) => n + g.count, 0);

function summaryLine(
  ghosts: number,
  occurrences: number,
  runs: SarifRun[],
  configs?: number,
): string {
  const across = configs === undefined ? '' : ` across ${plural(configs, 'config')}`;
  const results = runs.reduce((n, run) => n + run.results.length, 0);
  return (
    `${SARIF_TOOL_NAME}: ${plural(ghosts, 'ghost class', 'ghost classes')}, ` +
    `${plural(occurrences, 'occurrence')}${across} → ` +
    `${plural(results, 'SARIF result')} in ${plural(runs.length, 'run')}`
  );
}

/** A SARIF 2.1.0 log with a single run, for one Tailwind config. */
export function formatSarif(report: Report, options: SarifFormatOptions = {}): SarifFormatResult {
  const run = buildRun(report, sarifRules(options.unknown === true), options);
  return {
    log: { $schema: SARIF_SCHEMA_URI, version: SARIF_VERSION, runs: [run] },
    summary: summaryLine(report.ghosts.length, occurrencesOf(report), [run]),
  };
}

/**
 * `automationDetails.id` for a run that analyzed `config` (a path relative to the shared cwd, as
 * {@link ConfigReport.config} and `configLabel` produce it).
 *
 * Both multi-config paths must produce the same string for the same config — see
 * {@link formatSarifMany}.
 */
export function automationIdFor(config: string): string {
  return `${SARIF_TOOL_NAME}/${config}`;
}

/**
 * A SARIF 2.1.0 log with **one run per config** (`--all-configs`, repeated `--config`).
 *
 * The same class can be a ghost under one config and perfectly fine under another, so merging
 * every config into one run would lose the only thing that explains the verdict. Code Scanning
 * renders runs separately, so one run per config keeps that split visible.
 *
 * **Every** run carries `automationDetails.id = "tw-ghost/<config>"`, including when it is the only
 * one left. Code Scanning keys an analysis by that id: deriving it from how many configs *succeeded*
 * would rename the survivors the moment a sibling config broke, and GitHub would read the rename as
 * a different analysis — retiring and re-opening the alerts of a config that never changed, exactly
 * when the scan is least trustworthy. The id names which config a run came from, which is a
 * property of the request, not of the outcome.
 *
 * The same reasoning reaches past this function: a multi-config *request* that happens to match one
 * config is routed to {@link formatSarif} by the CLI, which passes the id from
 * {@link automationIdFor} so that adding or deleting a sibling config does not rename the one that
 * stayed. Use that helper rather than rebuilding the string — the two paths must agree byte for
 * byte, or the rename they exist to prevent happens anyway.
 *
 * The single-config path (`formatSarif`) still emits no `automationDetails`, so `upload-sarif`'s
 * `category:` names it: the action fills `automationDetails` only when it is absent
 * (`populateRunAutomationDetails`), so it never overwrites the ids set here.
 *
 * Configs that failed to load are not runs — they have no findings to report. They are already on
 * stderr and already force exit 2, which is what gates the upload.
 */
export function formatSarifMany(
  multi: MultiReport,
  options: SarifFormatOptions = {},
): SarifFormatResult {
  const reports = multi.configs.filter((e): e is ConfigReport => !isConfigFailure(e));
  const runs = reports.map((entry) =>
    buildRun(entry, sarifRules(options.unknown === true), {
      ...options,
      automationId: automationIdFor(entry.config),
    }),
  );
  const ghosts = reports.reduce((n, entry) => n + entry.ghosts.length, 0);
  const occurrences = reports.reduce((n, entry) => n + occurrencesOf(entry), 0);
  return {
    log: { $schema: SARIF_SCHEMA_URI, version: SARIF_VERSION, runs },
    summary: summaryLine(ghosts, occurrences, runs, reports.length),
  };
}
