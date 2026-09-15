import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { glob } from 'tinyglobby';
import {
  DEFAULT_SEPARATOR,
  classify,
  collectRoots,
  isPlausibleVariantChain,
  looksUtilityLike,
  splitVariants,
} from './classify.js';
import { TwGhostConfigError } from './errors.js';
import {
  type CandidateOccurrences,
  type Location,
  createExtractor,
  scanContent,
} from './extract.js';
import { generate, stockConfigFrom } from './generate.js';
import { contentGlobs, findConfig, loadProject } from './project.js';
import { suggestReplacements } from './suggest.js';

export interface AnalyzeOptions {
  /** Path to tailwind.config.*; auto-detected by walking up from `cwd` when omitted. */
  config?: string | undefined;
  /** Base directory for auto-detection, positional globs and relative paths in the report. Default: process.cwd(). */
  cwd?: string | undefined;
  /** Files to scan. Default: the config's `content` globs (resolved relative to the config file). */
  globs?: string[] | undefined;
  /**
   * When the input set is empty (no globs, or globs that match no file), return an empty report
   * instead of throwing `TwGhostConfigError`. Default: false — a silent empty scan would pass CI.
   */
  allowEmpty?: boolean | undefined;
  /** Class names matching any of these patterns are skipped entirely. */
  ignore?: Array<string | RegExp> | undefined;
  /** Populate `unknown` / `unknownVariant` in the report (typo detection). Default: false. */
  unknown?: boolean | undefined;
  /** Locations kept per finding (0 = unlimited). Default: 3. */
  maxLocations?: number | undefined;
  /** Compute replacement suggestions for ghosts. Default: true. */
  suggestions?: boolean | undefined;
}

export interface Finding {
  class: string;
  count: number;
  locations: Location[];
}

export interface GhostFinding extends Finding {
  /** Declarations stock Tailwind would have emitted for this class (or for its bare utility). */
  stockCss: string[];
  /** Project classes with the same root that set the same CSS properties. */
  suggestions: string[];
}

export interface Summary {
  /** Candidates the project config emits CSS for. */
  ok: number;
  /** Candidates stock Tailwind emits CSS for (directly, or via their bare utility) but the project does not. */
  ghost: number;
  /** Raw count of candidates that produced nothing anywhere — mostly ordinary words from the source. */
  unknown: number;
  /** Candidates whose bare utility works in the project but whose variant chain does not. */
  unknownVariant: number;
  /** The subset of `unknown` that passes the utility-looking heuristic (what `--unknown` would list). */
  unknownUtilityLike: number;
}

export interface Report {
  configPath: string;
  tailwindVersion: string;
  extractor: 'project' | 'bundled';
  filesScanned: number;
  candidateCount: number;
  summary: Summary;
  ghosts: GhostFinding[];
  /** Only populated when `unknown: true`; filtered to utility-looking names. */
  unknown: Finding[];
  /** Only populated when `unknown: true`: valid utility, unrecognised variant chain. */
  unknownVariant: Finding[];
  durationMs: number;
}

const DEFAULT_IGNORE_GLOBS = ['**/node_modules/**', '**/dist/**', '**/.next/**', '**/.git/**'];

const asRecord = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

function toRegExp(p: string | RegExp): RegExp {
  if (p instanceof RegExp) return p;
  try {
    return new RegExp(p);
  } catch (error) {
    throw new TwGhostConfigError(
      `Invalid --ignore pattern ${JSON.stringify(p)}: ${(error as Error).message}`,
    );
  }
}

async function resolveFiles(
  patterns: string[],
  base: string,
  allowEmpty: boolean,
): Promise<string[]> {
  const positive: string[] = [];
  const negative: string[] = [...DEFAULT_IGNORE_GLOBS];
  for (const p of patterns) {
    if (p.startsWith('!')) negative.push(p.slice(1));
    else positive.push(p);
  }
  if (positive.length === 0) {
    if (allowEmpty) return [];
    throw new TwGhostConfigError(
      'Nothing to scan: pass file globs on the command line or add string globs to the config\'s "content" (or pass --allow-empty).',
    );
  }
  const files = await glob(positive, {
    cwd: base,
    ignore: negative,
    absolute: true,
    onlyFiles: true,
  });
  if (files.length === 0 && !allowEmpty) {
    const shown = positive.map((p) => JSON.stringify(p)).join(', ');
    throw new TwGhostConfigError(
      `No files matched ${shown} (resolved from ${base}). Check the globs — a silent "0 files scanned" would let every ghost through. Pass --allow-empty to accept an empty scan.`,
    );
  }
  return files.sort();
}

export async function analyze(options: AnalyzeOptions = {}): Promise<Report> {
  const started = performance.now();
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const configPath = options.config ? path.resolve(cwd, options.config) : findConfig(cwd);
  if (!configPath) {
    throw new TwGhostConfigError(
      `No tailwind.config.{ts,js,cjs,mjs} found walking up from ${cwd}. Pass --config <path>.`,
    );
  }
  const project = loadProject(configPath);
  const allowEmpty = options.allowEmpty === true;

  const files =
    options.globs && options.globs.length > 0
      ? await resolveFiles(options.globs, cwd, allowEmpty)
      : await resolveFiles(contentGlobs(project.config), project.configDir, allowEmpty);

  const { extract, source: extractor } = createExtractor(project);
  const occurrences: CandidateOccurrences = { locations: new Map() };
  for (const file of files) {
    const text = await readFile(file, 'utf8');
    scanContent(path.relative(cwd, file).split(path.sep).join('/'), text, extract, occurrences);
  }

  const ignore = (options.ignore ?? []).map(toRegExp);
  const candidates = Array.from(occurrences.locations.keys()).filter(
    (c) => !ignore.some((re) => re.test(c)),
  );

  const separator = project.resolved.separator ?? DEFAULT_SEPARATOR;
  // candidate → its bare utility, for every candidate that carries a variant chain
  const bareUtility = new Map<string, string>();
  for (const candidate of candidates) {
    const { variants, utility } = splitVariants(candidate, separator);
    if (variants !== '' && utility !== '' && isPlausibleVariantChain(variants, separator)) {
      bareUtility.set(candidate, utility);
    }
  }
  // Both runs also see each variant-bearing candidate's bare utility, so a candidate the stock
  // run cannot resolve (`hocus:text-sm` — the variant only exists in the project) is judged by
  // whether `text-sm` itself is alive in the project.
  const toGenerate = new Set([...candidates, ...bareUtility.values()]);

  const projectCss = await generate(project, project.config, toGenerate);
  // The stock run sees the default screens AND the project's: a custom breakpoint (`tablet:`)
  // resolves there, and so does a stock breakpoint the project removed (`2xl:` after replacing
  // `screens`) — both keep the full candidate in the stock set, i.e. a ghost by CSS output.
  const stockScreens = {
    ...asRecord(project.stockResolved.theme?.screens),
    ...asRecord(project.resolved.theme?.screens),
  };
  const stockCss = await generate(
    project,
    stockConfigFrom(project.config, { screens: stockScreens }),
    toGenerate,
  );

  const maxLocations = options.maxLocations ?? 3;
  const clip = (locs: Location[]): Location[] =>
    maxLocations > 0 ? locs.slice(0, maxLocations) : locs;
  const summary: Summary = {
    ok: 0,
    ghost: 0,
    unknown: 0,
    unknownVariant: 0,
    unknownUtilityLike: 0,
  };
  const ghosts: GhostFinding[] = [];
  const unknownAll: Finding[] = [];
  const unknownVariantAll: Finding[] = [];
  for (const candidate of candidates) {
    const verdict = classify(candidate, projectCss.classes, stockCss.classes, separator);
    const locations = occurrences.locations.get(candidate) ?? [];
    const finding: Finding = {
      class: candidate,
      count: locations.length,
      locations: clip(locations),
    };
    if (verdict === 'ok') {
      summary.ok += 1;
    } else if (verdict === 'ghost') {
      summary.ghost += 1;
      const stockKey = stockCss.classes.has(candidate)
        ? candidate
        : (bareUtility.get(candidate) ?? candidate);
      ghosts.push({
        ...finding,
        stockCss: stockCss.declarations.get(stockKey) ?? [],
        suggestions: [],
      });
    } else if (verdict === 'unknown-variant') {
      summary.unknownVariant += 1;
      unknownVariantAll.push(finding);
    } else {
      summary.unknown += 1;
      unknownAll.push(finding);
    }
  }
  const byCountThenName = (a: Finding, b: Finding): number =>
    b.count - a.count || a.class.localeCompare(b.class);
  ghosts.sort(byCountThenName);

  if (options.suggestions !== false && ghosts.length > 0) {
    const suggestions = await suggestReplacements(project, ghosts);
    for (const ghost of ghosts) ghost.suggestions = suggestions.get(ghost.class) ?? [];
  }

  const roots = collectRoots([...projectCss.classes, ...stockCss.classes], separator);
  const unknownUtilityLike = unknownAll
    .filter((f) => looksUtilityLike(f.class, roots, separator))
    .sort(byCountThenName);
  summary.unknownUtilityLike = unknownUtilityLike.length;

  return {
    configPath,
    tailwindVersion: project.tailwindVersion,
    extractor,
    filesScanned: files.length,
    candidateCount: candidates.length,
    summary,
    ghosts,
    unknown: options.unknown ? unknownUtilityLike : [],
    unknownVariant: options.unknown ? unknownVariantAll.sort(byCountThenName) : [],
    durationMs: Math.round(performance.now() - started),
  };
}
