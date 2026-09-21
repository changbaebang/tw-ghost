import { existsSync } from 'node:fs';
import path from 'node:path';
import { glob, isDynamicPattern } from 'tinyglobby';
import { type AnalyzeOptions, analyze, type Report, type Summary } from './analyze.js';
import { TwGhostConfigError } from './errors.js';
import { CONFIG_FILE_NAMES } from './project.js';

/** Directories `--all-configs` never descends into. */
export const ALL_CONFIGS_IGNORE_DIRS = [
  'node_modules',
  'dist',
  '.next',
  'build',
  'out',
  'coverage',
] as const;

export interface ResolveConfigsOptions {
  /** `--config` values: paths or globs, resolved from `cwd`. */
  configs?: string[] | undefined;
  /** `--all-configs`: discover every `tailwind.config.{ts,js,cjs,mjs}` under `cwd`. */
  all?: boolean | undefined;
  cwd?: string | undefined;
}

const toPosix = (p: string): string => p.split(path.sep).join('/');

/**
 * Turn `--config` values (paths and globs) and/or `--all-configs` into a sorted, de-duplicated
 * list of absolute config paths. Throws `TwGhostConfigError` when a glob matches nothing or
 * discovery finds nothing. Returns `[]` when neither option is given (caller auto-detects).
 */
export async function resolveConfigPaths(options: ResolveConfigsOptions = {}): Promise<string[]> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const found = new Set<string>();

  for (const input of options.configs ?? []) {
    if (!isDynamicPattern(input)) {
      found.add(path.resolve(cwd, input));
      continue;
    }
    const matches = await glob([input], {
      cwd,
      ignore: ['**/node_modules/**'],
      absolute: true,
      onlyFiles: true,
    });
    if (matches.length === 0) {
      throw new TwGhostConfigError(
        `--config ${JSON.stringify(input)} matched no file (resolved from ${cwd}).`,
      );
    }
    for (const m of matches) found.add(path.resolve(m));
  }

  if (options.all) {
    const matches = await glob([`**/{${CONFIG_FILE_NAMES.join(',')}}`], {
      cwd,
      ignore: ALL_CONFIGS_IGNORE_DIRS.map((d) => `**/${d}/**`),
      absolute: true,
      onlyFiles: true,
    });
    if (matches.length === 0) {
      throw new TwGhostConfigError(
        `--all-configs found no tailwind.config.{ts,js,cjs,mjs} under ${cwd} (skipping ${ALL_CONFIGS_IGNORE_DIRS.join(', ')}).`,
      );
    }
    for (const m of matches) found.add(path.resolve(m));
  }

  return Array.from(found).sort();
}

export type AnalyzeManyOptions = Omit<AnalyzeOptions, 'config'>;

/** One successfully analyzed config: `config` (relative to `cwd`) plus the usual report. */
export interface ConfigReport extends Report {
  config: string;
  error?: undefined;
}

/** A config that could not be loaded or analyzed; the run continues with the others. */
export interface ConfigFailure {
  config: string;
  error: string;
}

export type ConfigResult = ConfigReport | ConfigFailure;

export interface MultiSummary extends Summary {
  /** Number of configs analyzed (successful + failed). */
  configs: number;
  /** Configs that threw while loading / analyzing. */
  failed: number;
  filesScanned: number;
  candidateCount: number;
}

export interface MultiReport {
  configs: ConfigResult[];
  summary: MultiSummary;
  durationMs: number;
}

export const isConfigFailure = (r: ConfigResult): r is ConfigFailure => typeof r.error === 'string';

/**
 * Run `analyze()` once per config, independently, and aggregate. A config that throws becomes a
 * `{ config, error }` entry instead of aborting the run. The same ghost class is reported under
 * every config whose scan sees it (no cross-config de-duplication).
 */
export async function analyzeMany(
  configs: string[],
  options: AnalyzeManyOptions = {},
): Promise<MultiReport> {
  const started = performance.now();
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const results: ConfigResult[] = [];
  const summary: MultiSummary = {
    configs: configs.length,
    failed: 0,
    filesScanned: 0,
    candidateCount: 0,
    ok: 0,
    ghost: 0,
    unknown: 0,
    unknownVariant: 0,
    unknownUtilityLike: 0,
  };
  for (const configInput of configs) {
    const absolute = path.resolve(cwd, configInput);
    const config = toPosix(path.relative(cwd, absolute)) || '.';
    try {
      if (!existsSync(absolute)) {
        throw new TwGhostConfigError(`Config file not found: ${absolute}`);
      }
      const report = await analyze({ ...options, cwd, config: absolute });
      results.push({ config, ...report });
      summary.filesScanned += report.filesScanned;
      summary.candidateCount += report.candidateCount;
      summary.ok += report.summary.ok;
      summary.ghost += report.summary.ghost;
      summary.unknown += report.summary.unknown;
      summary.unknownVariant += report.summary.unknownVariant;
      summary.unknownUtilityLike += report.summary.unknownUtilityLike;
    } catch (error) {
      summary.failed += 1;
      results.push({
        config,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { configs: results, summary, durationMs: Math.round(performance.now() - started) };
}
