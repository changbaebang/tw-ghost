import path from 'node:path';
import type { Finding, GhostFinding, Report } from './analyze.js';
import type { Location } from './extract.js';
import { toPosix } from './paths.js';

/**
 * GitHub Actions workflow-command output (`--format github`): one `::error` annotation per ghost
 * occurrence, optionally `::warning` annotations for `--unknown` findings, a `::notice` when the
 * cap cuts the list, and a one-line summary for stderr.
 *
 * Escaping follows `@actions/core` (`escapeData` / `escapeProperty`): `%`, `\r`, `\n` in every
 * string, plus `:` and `,` in property values.
 */
export interface GithubFormatOptions {
  /** Base the report's relative paths resolve against. Default: process.cwd(). */
  cwd?: string | undefined;
  /**
   * Repository root the `file=` property should be relative to. Default: `GITHUB_WORKSPACE`.
   * Files outside it (or when unset) stay relative to `cwd`.
   */
  workspace?: string | undefined;
  /** Annotations printed before a `::notice` reports the rest as omitted. 0 = unlimited. Default: 50. */
  maxAnnotations?: number | undefined;
}

export interface GithubFormatResult {
  /** Workflow commands, newline-separated, for stdout. Empty string when there is nothing to annotate. */
  output: string;
  /** `tw-ghost: N ghost classes, M occurrences` — for stderr. */
  summary: string;
  /** Annotations that did not fit under `maxAnnotations`. */
  omitted: number;
}

export const DEFAULT_MAX_ANNOTATIONS = 50;

export const escapeData = (s: string): string =>
  s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');

export const escapeProperty = (s: string): string =>
  escapeData(s).replace(/:/g, '%3A').replace(/,/g, '%2C');

/** Path for the `file=` property: relative to the workspace when the file lives under it, else to `cwd`. */
export function relativizeFile(file: string, cwd: string, workspace: string | undefined): string {
  const abs = path.resolve(cwd, file);
  if (workspace) {
    const rel = path.relative(path.resolve(workspace), abs);
    if (rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)) return toPosix(rel);
  }
  return toPosix(path.relative(cwd, abs));
}

export function annotation(
  level: 'error' | 'warning' | 'notice',
  loc: Location,
  file: string,
  title: string,
  message: string,
): string {
  const props = [
    `file=${escapeProperty(file)}`,
    `line=${loc.line}`,
    `col=${loc.col}`,
    `title=${escapeProperty(title)}`,
  ].join(',');
  return `::${level} ${props}::${escapeData(message)}`;
}

const plural = (n: number, word: string, many = `${word}s`): string =>
  `${n} ${n === 1 ? word : many}`;

function ghostMessage(g: GhostFinding): string {
  const tryPart = g.suggestions.length > 0 ? ` — try: ${g.suggestions.join(', ')}` : '';
  return `${g.class} produces no CSS in this Tailwind config${tryPart}`;
}

export function formatGithub(
  report: Report,
  options: GithubFormatOptions = {},
): GithubFormatResult {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const workspace = options.workspace ?? process.env.GITHUB_WORKSPACE;
  const max = options.maxAnnotations ?? DEFAULT_MAX_ANNOTATIONS;
  const file = (loc: Location): string => relativizeFile(loc.file, cwd, workspace);

  const lines: string[] = [];
  for (const g of report.ghosts) {
    const message = ghostMessage(g);
    for (const loc of g.locations)
      lines.push(annotation('error', loc, file(loc), 'tw-ghost', message));
  }
  const warn = (f: Finding, message: string): void => {
    for (const loc of f.locations)
      lines.push(annotation('warning', loc, file(loc), 'tw-ghost (unknown)', message));
  };
  for (const u of report.unknown)
    warn(u, `${u.class} produces no CSS in stock Tailwind or this config (typo or custom CSS?)`);
  for (const u of report.unknownVariant)
    warn(u, `${u.class}: the utility works in this config but its variant chain is unknown`);

  const kept = max > 0 ? lines.slice(0, max) : lines;
  const omitted = lines.length - kept.length;
  if (omitted > 0) kept.push(`::notice::tw-ghost: ${omitted} more annotations omitted`);

  const occurrences = report.ghosts.reduce((n, g) => n + g.count, 0);
  return {
    output: kept.join('\n'),
    summary: `tw-ghost: ${plural(report.ghosts.length, 'ghost class', 'ghost classes')}, ${plural(occurrences, 'occurrence')}`,
    omitted,
  };
}
