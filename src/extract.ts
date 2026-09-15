import type { LoadedProject } from './project.js';

export type Extractor = (content: string) => string[];

export interface Location {
  file: string;
  line: number;
  col: number;
}

export interface CandidateOccurrences {
  /** candidate → every location it was seen at (in scan order) */
  locations: Map<string, Location[]>;
}

/**
 * Try to use the project's own Tailwind default extractor (so candidate detection matches
 * what the project's Tailwind build would see). Falls back to a bundled copy of the v3 logic.
 */
export function createExtractor(project: LoadedProject): {
  extract: Extractor;
  source: 'project' | 'bundled';
} {
  const context = {
    tailwindConfig: {
      separator: project.resolved.separator ?? ':',
      prefix: project.resolved.prefix ?? '',
    },
  };
  try {
    const mod = project.require('tailwindcss/lib/lib/defaultExtractor') as {
      defaultExtractor?: (ctx: typeof context) => Extractor;
    };
    if (typeof mod.defaultExtractor === 'function') {
      const extract = mod.defaultExtractor(context);
      // Smoke-test the extractor so a broken internal import degrades gracefully.
      if (Array.isArray(extract('p-4'))) return { extract, source: 'project' };
    }
  } catch {
    // fall through to bundled copy
  }
  return { extract: bundledDefaultExtractor(context), source: 'bundled' };
}

/**
 * Characters that can continue a class token. A candidate only counts where the characters
 * around it are NOT of this kind, so `text-sm` is not found inside `md:text-sm`,
 * `legacy-text-sm` or `text-sm/50`, and `p-3` is not found inside `p-30`, `!p-3` or `-p-3`.
 * `.` is a boundary (`a.text-sm` splits there in Tailwind's extractor too) unless a digit
 * follows it — `p-3.5` is one token, so `p-3` must not be found inside it.
 */
const TOKEN_CHAR = /[A-Za-z0-9_\-:/!@#%[\]]/;

/** True when `line.slice(idx, idx + length)` is a whole token, not part of a longer one. */
export function isWholeToken(line: string, idx: number, length: number): boolean {
  const before = idx > 0 ? (line[idx - 1] as string) : '';
  const after = line[idx + length] ?? '';
  if (before !== '' && TOKEN_CHAR.test(before)) return false;
  if (after !== '' && TOKEN_CHAR.test(after)) return false;
  if (after === '.' && /\d/.test(line[idx + length + 1] ?? '')) return false;
  return true;
}

/**
 * Scan one file's text line by line, recording a 1-based `line:col` for every place a candidate
 * appears as a whole token. Extractor output that never appears as a whole token (`w-` and
 * `13px` split out of `w-[13px]`, `text-sm` inside `legacy-text-sm`) is not recorded at all.
 */
export function scanContent(
  file: string,
  text: string,
  extract: Extractor,
  into: CandidateOccurrences,
): void {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] as string;
    if (line.trim() === '') continue;
    const seen = new Set<string>();
    for (const candidate of extract(line)) {
      if (!candidate || seen.has(candidate)) continue;
      seen.add(candidate);
      let from = 0;
      for (;;) {
        const idx = line.indexOf(candidate, from);
        if (idx === -1) break;
        from = idx + candidate.length;
        if (!isWholeToken(line, idx, candidate.length)) continue;
        let list = into.locations.get(candidate);
        if (!list) {
          list = [];
          into.locations.set(candidate, list);
        }
        list.push({ file, line: i + 1, col: idx + 1 });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Bundled copy of Tailwind CSS v3's default extractor (MIT, Tailwind Labs).
// Used only when `tailwindcss/lib/lib/defaultExtractor` cannot be loaded.
// ---------------------------------------------------------------------------

const REGEX_SPECIAL = /[\\^$.*+?()[\]{}|]/g;
const REGEX_HAS_SPECIAL = new RegExp(REGEX_SPECIAL.source);
type Src = string | RegExp | Array<string | RegExp>;

function toSource(source: Src): string {
  const list = Array.isArray(source) ? source : [source];
  return list.map((item) => (item instanceof RegExp ? item.source : item)).join('');
}
function pattern(source: Src): RegExp {
  return new RegExp(toSource(source), 'g');
}
function any(sources: Src[]): string {
  return `(?:${sources.map(toSource).join('|')})`;
}
function optional(source: Src): string {
  return `(?:${toSource(source)})?`;
}
function escapeRegex(s: string): string {
  return s && REGEX_HAS_SPECIAL.test(s) ? s.replace(REGEX_SPECIAL, '\\$&') : s || '';
}

function* buildRegExps(ctx: {
  tailwindConfig: { separator: string; prefix: string };
}): Generator<RegExp> {
  const separator = ctx.tailwindConfig.separator;
  const prefix =
    ctx.tailwindConfig.prefix !== ''
      ? optional(pattern([/-?/, escapeRegex(ctx.tailwindConfig.prefix)]))
      : '';
  const utility = any([
    /\[[^\s:'"`]+:[^\s\[\]]+\]/,
    /\[[^\s:'"`\]]+:[^\s]+?\[[^\s]+\][^\s]+?\]/,
    pattern([
      any([/-?(?:\w+)/, /@(?:\w+)/]),
      optional(
        any([
          pattern([
            any([
              /-(?:\w+-)*\['[^\s]+'\]/,
              /-(?:\w+-)*\["[^\s]+"\]/,
              /-(?:\w+-)*\[`[^\s]+`\]/,
              /-(?:\w+-)*\[(?:[^\s\[\]]+\[[^\s\[\]]+\])*[^\s:\[\]]+\]/,
            ]),
            /(?![{([]])/,
            /(?:\/[^\s'"`\\><$]*)?/,
          ]),
          pattern([
            any([
              /-(?:\w+-)*\['[^\s]+'\]/,
              /-(?:\w+-)*\["[^\s]+"\]/,
              /-(?:\w+-)*\[`[^\s]+`\]/,
              /-(?:\w+-)*\[(?:[^\s\[\]]+\[[^\s\[\]]+\])*[^\s\[\]]+\]/,
            ]),
            /(?![{([]])/,
            /(?:\/[^\s'"`\\$]*)?/,
          ]),
          /[-\/][^\s'"`\\$={><]*/,
        ]),
      ),
    ]),
  ]);
  const variantPatterns = [
    any([
      pattern([/@\[[^\s"'`]+\](\/[^\s"'`]+)?/, separator]),
      pattern([/([^\s"'`\[\\]+-)?\[[^\s"'`]+\]\/[\w_-]+/, separator]),
      pattern([/([^\s"'`\[\\]+-)?\[[^\s"'`]+\]/, separator]),
      pattern([/[^\s"'`\[\\]+/, separator]),
    ]),
    any([
      pattern([/([^\s"'`\[\\]+-)?\[[^\s`]+\]\/[\w_-]+/, separator]),
      pattern([/([^\s"'`\[\\]+-)?\[[^\s`]+\]/, separator]),
      pattern([/[^\s`\[\\]+/, separator]),
    ]),
  ];
  for (const variantPattern of variantPatterns) {
    yield pattern(['((?=((', variantPattern, ')+))\\2)?', /!?/, prefix, utility]);
  }
  yield /[^<>"'`\s.(){}[\]#=%$][^<>"'`\s(){}[\]#=%$]*[^<>"'`\s.(){}[\]#=%:$]/g;
}

const SPECIALS = /([\[\]'"`])([^\[\]'"`])?/g;
const ALLOWED_CLASS_CHARACTERS = /[^"'`\s<>\]]+/;

function clipAtBalancedParens(input: string): string {
  if (!input.includes('-[')) return input;
  let depth = 0;
  const openStringTypes: string[] = [];
  const matches = Array.from(input.matchAll(SPECIALS)).flatMap((match) => {
    const [, ...groups] = match;
    return groups.map((group, idx) => ({ char: group, index: (match.index ?? 0) + idx }));
  });
  for (const match of matches) {
    const char = match.char;
    const inStringType = openStringTypes[openStringTypes.length - 1];
    if (char === inStringType) {
      openStringTypes.pop();
    } else if (char === "'" || char === '"' || char === '`') {
      openStringTypes.push(char);
    }
    if (inStringType) continue;
    if (char === '[') {
      depth += 1;
      continue;
    }
    if (char === ']') {
      depth -= 1;
      continue;
    }
    if (depth < 0) return input.substring(0, match.index - 1);
    if (depth === 0 && !ALLOWED_CLASS_CHARACTERS.test(char ?? '')) {
      return input.substring(0, match.index);
    }
  }
  return input;
}

function splitAtTopLevelOnly(input: string, separator: string): string[] {
  const stack: string[] = [];
  const parts: string[] = [];
  let lastPos = 0;
  let isEscaped = false;
  for (let idx = 0; idx < input.length; idx += 1) {
    const char = input[idx] as string;
    if (stack.length === 0 && char === separator[0] && !isEscaped) {
      if (separator.length === 1 || input.slice(idx, idx + separator.length) === separator) {
        parts.push(input.slice(lastPos, idx));
        lastPos = idx + separator.length;
      }
    }
    isEscaped = isEscaped ? false : char === '\\';
    if (char === '(' || char === '[' || char === '{') {
      stack.push(char);
    } else if (
      (char === ')' && stack[stack.length - 1] === '(') ||
      (char === ']' && stack[stack.length - 1] === '[') ||
      (char === '}' && stack[stack.length - 1] === '{')
    ) {
      stack.pop();
    }
  }
  parts.push(input.slice(lastPos));
  return parts;
}

export function bundledDefaultExtractor(ctx: {
  tailwindConfig: { separator: string; prefix: string };
}): Extractor {
  const patterns = Array.from(buildRegExps(ctx));
  return (content: string) => {
    const results: string[] = [];
    for (const p of patterns) {
      for (const result of content.match(p) ?? []) {
        results.push(clipAtBalancedParens(result));
      }
    }
    for (const result of results.slice()) {
      const segments = splitAtTopLevelOnly(result, '.');
      for (let idx = 0; idx < segments.length; idx += 1) {
        const segment = segments[idx] as string;
        if (idx >= segments.length - 1) {
          results.push(segment);
          continue;
        }
        const next = Number(segments[idx + 1]);
        if (Number.isNaN(next)) {
          results.push(segment);
        } else {
          idx += 1;
        }
      }
    }
    return results;
  };
}
