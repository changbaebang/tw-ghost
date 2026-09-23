import { readFile, writeFile } from 'node:fs/promises';
import pc from 'picocolors';
import { DEFAULT_SEPARATOR, splitVariants } from './classify.js';
import { TwGhostConfigError } from './errors.js';
import { isWholeToken } from './extract.js';
import { splitBom } from './paths.js';

/**
 * A fix map: bare utility (no variants, no `!`, no leading `-`) → replacement bare utility, or
 * `null` to remove the class. Variants, `!` and `-` on an occurrence are carried over to the
 * replacement: with `{ "text-sm": "text-l" }`, `md:hover:!text-sm` becomes `md:hover:!text-l`.
 */
export type FixMap = Readonly<Record<string, string | null>>;

/**
 * A fix map *draft*, as written by `--fix-map-init`: values may also be an array of candidates
 * (from the ghost's suggestions) that the user is expected to reduce to one string or `null`.
 */
export type FixMapDraft = Readonly<Record<string, string | null | readonly string[]>>;

export interface FixEdit {
  file: string;
  line: number;
  col: number;
  from: string;
  to: string | null;
}

export interface FixResult {
  /** Every replacement or removal, in file order. */
  edits: FixEdit[];
  /** Files that changed (written only with `write: true`). */
  files: string[];
  /** Ghost classes present in the map that were never seen in the scanned files. */
  unused: string[];
  /** Ghost classes seen but absent from the map (left untouched). */
  unmapped: string[];
}

const BARE = /^[^\s:!]+$/;

/** Parse and validate the JSON text of a fix map. A draft with array values is rejected. */
export function parseFixMap(text: string, source = 'fix map'): FixMap {
  let raw: unknown;
  try {
    // A BOM is not valid JSON: Notepad and PowerShell 5.1's `Set-Content` write one by default,
    // so a fix map edited on Windows would otherwise die with "Unexpected token".
    raw = JSON.parse(splitBom(text)[1]);
  } catch (error) {
    throw new TwGhostConfigError(`${source}: invalid JSON (${(error as Error).message})`);
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TwGhostConfigError(
      `${source}: expected an object of { "ghost-class": "replacement" | null }`,
    );
  }
  const map: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!BARE.test(key)) {
      throw new TwGhostConfigError(
        `${source}: key ${JSON.stringify(key)} must be a bare utility (no variants, no "!", no whitespace); variants are carried over automatically`,
      );
    }
    if (Array.isArray(value)) {
      throw new TwGhostConfigError(
        `${source}: ${JSON.stringify(key)} still has ${value.length} candidates — pick one (a string) or null to remove the class`,
      );
    }
    if (value !== null && (typeof value !== 'string' || !BARE.test(value))) {
      throw new TwGhostConfigError(
        `${source}: ${JSON.stringify(key)} must map to a bare utility string or null (got ${JSON.stringify(value)})`,
      );
    }
    if (value === key) continue;
    map[key] = value;
  }
  return map;
}

/** Split an occurrence into its shell and bare utility, honouring the separator. */
function splitShell(
  candidate: string,
  separator: string,
): { variants: string; bang: string; neg: string; utility: string } {
  const { variants, utility: rest } = splitVariants(candidate, separator);
  let utility = rest;
  let bang = '';
  let neg = '';
  if (utility.startsWith('!')) {
    bang = '!';
    utility = utility.slice(1);
  }
  if (utility.startsWith('-')) {
    neg = '-';
    utility = utility.slice(1);
  }
  return { variants, bang, neg, utility };
}

/** The replacement for one occurrence, or `undefined` when its bare utility is not in the map. */
export function replacementFor(
  candidate: string,
  map: FixMap,
  separator: string = DEFAULT_SEPARATOR,
): string | null | undefined {
  const shell = splitShell(candidate, separator);
  if (!Object.hasOwn(map, shell.utility)) return undefined;
  const target = map[shell.utility];
  if (target === null) return null;
  return `${shell.variants}${shell.bang}${shell.neg}${target}`;
}

/**
 * Apply a fix map to one file's text. `candidates` is the list of ghost class names known to
 * occur in this file (whole-token matching, same rule as the scanner). Returns the new text and
 * the edits made; text is unchanged when there are no edits.
 */
export function applyFixMapToText(
  file: string,
  text: string,
  candidates: readonly string[],
  map: FixMap,
  separator: string = DEFAULT_SEPARATOR,
): { text: string; edits: FixEdit[] } {
  const plan = candidates
    .map((c) => ({ from: c, to: replacementFor(c, map, separator) }))
    .filter((p): p is { from: string; to: string | null } => p.to !== undefined)
    .sort((a, b) => b.from.length - a.from.length || a.from.localeCompare(b.from));
  if (plan.length === 0) return { text, edits: [] };

  const edits: FixEdit[] = [];
  // Split so that every line keeps its OWN terminator: `parts` alternates content, terminator,
  // content, … A file with mixed endings (routine on Windows, where Git, editors and generators
  // disagree) is then written back exactly as it was apart from the edits — picking one dominant
  // EOL for the whole file would rewrite every untouched line and bury the real diff.
  // The split must stay `\r?\n` to match `scanContent`, or reported line numbers would drift.
  const [bom, body] = splitBom(text);
  const parts = body.split(/(\r\n|\n)/);
  for (let i = 0; i < parts.length; i += 2) {
    const original = parts[i] as string;
    if (original.trim() === '') continue;
    // Find every whole-token occurrence on the ORIGINAL line first, so reported columns are
    // stable and no edit can be found inside the text another edit inserted.
    const hits: { idx: number; from: string; to: string | null }[] = [];
    for (const { from, to } of plan) {
      let searchFrom = 0;
      for (;;) {
        const idx = original.indexOf(from, searchFrom);
        if (idx === -1) break;
        searchFrom = idx + from.length;
        if (!isWholeToken(original, idx, from.length)) continue;
        hits.push({ idx, from, to });
      }
    }
    if (hits.length === 0) continue;
    hits.sort((a, b) => a.idx - b.idx);
    // Rebuild the line left to right; a removal also eats one adjacent space.
    let out = '';
    let cursor = 0;
    for (const hit of hits) {
      if (hit.idx < cursor) continue; // overlapping hit (cannot happen with whole tokens; belt and braces)
      out += original.slice(cursor, hit.idx);
      cursor = hit.idx + hit.from.length;
      if (hit.to === null) {
        if (original[cursor] === ' ') cursor += 1;
        else if (out.endsWith(' ')) out = out.slice(0, -1);
      } else {
        out += hit.to;
      }
      edits.push({ file, line: i / 2 + 1, col: hit.idx + 1, from: hit.from, to: hit.to });
    }
    out += original.slice(cursor);
    parts[i] = out;
  }
  edits.sort((a, b) => a.line - b.line || a.col - b.col);
  return { text: edits.length === 0 ? text : bom + parts.join(''), edits };
}

export interface ApplyFixMapOptions {
  /** Ghost class → files it occurs in (from the report's locations). */
  occurrences: ReadonlyMap<string, ReadonlySet<string>>;
  map: FixMap;
  separator?: string;
  /** Write changed files to disk. Default false (dry run). */
  write?: boolean;
}

/** Apply a fix map across files. Reads each affected file once; writes only with `write: true`. */
export async function applyFixMap(options: ApplyFixMapOptions): Promise<FixResult> {
  const separator = options.separator ?? DEFAULT_SEPARATOR;
  const byFile = new Map<string, string[]>();
  const seen = new Set<string>();
  for (const [candidate, files] of options.occurrences) {
    if (replacementFor(candidate, options.map, separator) === undefined) continue;
    seen.add(splitShell(candidate, separator).utility);
    for (const file of files) {
      let list = byFile.get(file);
      if (!list) {
        list = [];
        byFile.set(file, list);
      }
      list.push(candidate);
    }
  }
  const edits: FixEdit[] = [];
  const changed: string[] = [];
  for (const file of Array.from(byFile.keys()).sort()) {
    const text = await readFile(file, 'utf8');
    const result = applyFixMapToText(file, text, byFile.get(file) ?? [], options.map, separator);
    if (result.edits.length === 0) continue;
    edits.push(...result.edits);
    changed.push(file);
    if (options.write) await writeFile(file, result.text, 'utf8');
  }
  const unused = Object.keys(options.map).filter((k) => !seen.has(k));
  const unmapped = Array.from(
    new Set(
      Array.from(options.occurrences.keys())
        .map((c) => splitShell(c, separator).utility)
        .filter((u) => !Object.hasOwn(options.map, u)),
    ),
  ).sort();
  return { edits, files: changed, unused, unmapped };
}

/**
 * Build a fix-map draft from the ghosts of a report: bare utility → the single suggestion when
 * there is exactly one, the candidate list when there are several (bare, deduplicated), or `null`
 * when there is none (meaning "remove" until the user decides otherwise).
 */
export function draftFixMap(
  ghosts: ReadonlyArray<{ class: string; suggestions: readonly string[] }>,
  separator: string = DEFAULT_SEPARATOR,
): FixMapDraft {
  const draft: Record<string, string | null | string[]> = {};
  for (const ghost of ghosts) {
    const bare = splitShell(ghost.class, separator).utility;
    const candidates = Array.from(
      new Set(ghost.suggestions.map((s) => splitShell(s, separator).utility)),
    );
    const existing = draft[bare];
    if (existing !== undefined) {
      if (Array.isArray(existing)) {
        for (const c of candidates) if (!existing.includes(c)) existing.push(c);
      }
      continue;
    }
    if (candidates.length === 1) draft[bare] = candidates[0] as string;
    else if (candidates.length === 0) draft[bare] = null;
    else draft[bare] = candidates;
  }
  return Object.fromEntries(Object.entries(draft).sort(([a], [b]) => a.localeCompare(b)));
}

export interface FormatFixOptions {
  write: boolean;
  color: boolean;
}

/** Human-readable summary of a fix run. */
export function formatFix(result: FixResult, options: FormatFixOptions): string {
  const c = options.color
    ? pc
    : {
        ...pc,
        green: (t: string) => t,
        yellow: (t: string) => t,
        red: (t: string) => t,
        dim: (t: string) => t,
        bold: (t: string) => t,
      };
  const lines: string[] = [];
  const verb = options.write ? 'changed' : 'would change';
  const byFile = new Map<string, FixEdit[]>();
  for (const e of result.edits) {
    let list = byFile.get(e.file);
    if (!list) {
      list = [];
      byFile.set(e.file, list);
    }
    list.push(e);
  }
  for (const [file, edits] of byFile) {
    lines.push(c.bold(file));
    for (const e of edits) {
      const arrow =
        e.to === null
          ? `${c.red(e.from)} ${c.dim('(remove)')}`
          : `${c.red(e.from)} → ${c.green(e.to)}`;
      lines.push(`  ${c.dim(`${e.line}:${e.col}`)}  ${arrow}`);
    }
  }
  const header = `${options.write ? c.green('tw-ghost: fixed') : c.yellow('tw-ghost: dry run')}: ${result.edits.length} edits in ${result.files.length} files ${verb}${options.write ? '' : ' (add --write to apply)'}`;
  lines.unshift(header, '');
  if (result.unmapped.length > 0) {
    lines.push(
      '',
      `${c.yellow('unmapped')} (still ghosts, add them to the map): ${result.unmapped.join(', ')}`,
    );
  }
  if (result.unused.length > 0) {
    lines.push(
      '',
      `${c.dim('unused map entries')} (no occurrence found): ${result.unused.join(', ')}`,
    );
  }
  return `${lines.join('\n')}\n`;
}
