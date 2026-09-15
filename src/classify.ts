export type Verdict = 'ok' | 'ghost' | 'unknown' | 'unknown-variant';

/** Tailwind's default variant separator (`md:hover:text-sm`). */
export const DEFAULT_SEPARATOR = ':';

/**
 * ok              → the project config emits CSS for the candidate
 * ghost           → stock Tailwind emits CSS for it but the project config does not
 * unknown-variant → the candidate carries variants, its bare utility works in the project, but
 *                   the full candidate produced nothing (the variant chain is what is unknown)
 * unknown         → nothing emits anything (custom CSS class, plain word, typo)
 *
 * A candidate with variants that is in neither set is judged by its BASE utility (the part after
 * the last top-level `separator`): base in stock and not in project → ghost, base in project →
 * unknown-variant. That is what catches `tablet:text-sm` / `hocus:text-sm` when `text-sm` is dead —
 * the stock run knows nothing about project-defined variants, so the full candidate is never in
 * the stock set. For this to work, both sets must have been generated with the bare utilities of
 * every variant-bearing candidate included (see `analyze`). The chain must look like one
 * (`isPlausibleVariantChain`): Tailwind's extractor also emits tokens such as
 * `class="tablet:text-sm`, and those must stay `unknown` rather than double-report the ghost.
 */
export function classify(
  candidate: string,
  projectClasses: ReadonlySet<string>,
  stockClasses: ReadonlySet<string>,
  separator: string = DEFAULT_SEPARATOR,
): Verdict {
  if (projectClasses.has(candidate)) return 'ok';
  if (stockClasses.has(candidate)) return 'ghost';
  const { variants, utility } = splitVariants(candidate, separator);
  if (variants !== '' && utility !== '' && isPlausibleVariantChain(variants, separator)) {
    if (projectClasses.has(utility)) return 'unknown-variant';
    if (stockClasses.has(utility)) return 'ghost';
  }
  return 'unknown';
}

/** Prefixes that look utility-like by shape but are HTML/JS vocabulary, never Tailwind. */
const NON_UTILITY_PREFIXES = [
  'data-',
  'aria-',
  'http:',
  'https:',
  'file:',
  'mailto:',
  'tel:',
  'x-',
];

/** Roots of the Tailwind v3 core utilities (the part before the first `-`). */
export const CORE_UTILITY_ROOTS = new Set<string>(
  (
    'accent align animate antialiased appearance aspect auto backdrop basis bg block border bottom box break ' +
    'brightness capitalize caret clear col collapse columns container content contrast cursor decoration delay ' +
    'diagonal divide drop duration ease end fill filter fixed flex float flow font forced from gap grayscale grid ' +
    'grow h hidden hue hyphens indent inline inset invert invisible isolate isolation italic items justify ' +
    'leading left line lining list lowercase m max mb min mix ml mr ms mt mx my normal not object oldstyle opacity ' +
    'order ordinal origin outline overflow overline overscroll p pb pe pl place pointer proportional ps pt px py ' +
    'relative resize right ring rotate rounded row saturate scale scroll select self sepia shadow shrink size ' +
    'skew slashed snap sr space stacked start static sticky stroke sub subpixel table tabular text to top touch ' +
    'tracking transform transition translate truncate underline uppercase via visible w whitespace will z'
  ).split(' '),
);

const NUMBER_LIKE = /^-?\d+(\.\d+)?$/;

/** A bare utility must contain a dash (`text-smm`, `w-[13px]`); a lone word (`flex`) is not utility-like. */
const BARE_UTILITY_SHAPE = /^!?-?[a-z][a-z0-9-]*-[^\s]+$/;
/** Under a variant chain the root check does the work, so `md:flex` is allowed through. */
const VARIANT_UTILITY_SHAPE = /^!?-?[a-z][^\s]*$/;

/**
 * Heuristic used for `--unknown`: keep only candidates that look like a Tailwind utility
 * whose root is a real utility root (core, or one observed in the generated CSS).
 */
export function looksUtilityLike(
  candidate: string,
  observedRoots: ReadonlySet<string>,
  separator: string = DEFAULT_SEPARATOR,
): boolean {
  if (NON_UTILITY_PREFIXES.some((p) => candidate.startsWith(p))) return false;
  // `max-h-` / `before:content-` are template-literal stubs (`max-h-${x}`), never a real class.
  if (candidate.endsWith('-') || candidate.endsWith(separator)) return false;
  const { variants, utility } = splitVariants(candidate, separator);
  if (variants !== '' && !isPlausibleVariantChain(variants, separator)) return false;
  const shape = variants === '' ? BARE_UTILITY_SHAPE : VARIANT_UTILITY_SHAPE;
  if (!shape.test(utility)) return false;
  const root = utilityRoot(stripModifiers(utility));
  if (root === '' || NUMBER_LIKE.test(root)) return false;
  return CORE_UTILITY_ROOTS.has(root) || observedRoots.has(root);
}

/**
 * Split `md:hover:!-m-4` into its variant chain (`md:hover:`, trailing separator kept, `''`
 * when there is none) and the rest (`!-m-4`). Only top-level separators count — a `:` inside
 * `[...]` (arbitrary values / variants) is left alone — and multi-character separators work.
 */
export function splitVariants(
  candidate: string,
  separator: string = DEFAULT_SEPARATOR,
): { variants: string; utility: string } {
  let depth = 0;
  let lastSep = -1;
  for (let i = 0; i < candidate.length; i += 1) {
    const ch = candidate[i];
    if (ch === '[') depth += 1;
    else if (ch === ']') depth = Math.max(0, depth - 1);
    else if (depth === 0 && separator !== '' && candidate.startsWith(separator, i)) {
      lastSep = i;
      i += separator.length - 1;
    }
  }
  if (lastSep < 0) return { variants: '', utility: candidate };
  const end = lastSep + separator.length;
  return { variants: candidate.slice(0, end), utility: candidate.slice(end) };
}

/** Characters a variant chain may contain outside `[...]` (besides the separator itself). */
const VARIANT_CHAIN_CHAR = /[A-Za-z0-9_\-@*/.]/;

/**
 * Whether `variants` (a chain with its trailing separator, from `splitVariants`) could be a real
 * Tailwind variant chain: outside brackets only variant-name characters and the separator
 * (`md:`, `group-hover/edit:`, `*:`, `@md:`, `2xl:`), anything inside balanced `[...]`
 * (`[&_svg]:`, `data-[state="open"]:`, `supports-[display:grid]:`). Extractor noise such as
 * `class="tablet:` or `clsx('md:` fails this and is not judged by its bare utility.
 */
export function isPlausibleVariantChain(
  variants: string,
  separator: string = DEFAULT_SEPARATOR,
): boolean {
  if (variants === '') return false;
  let depth = 0;
  for (let i = 0; i < variants.length; i += 1) {
    const ch = variants[i] as string;
    if (ch === '[') depth += 1;
    else if (ch === ']') {
      if (depth === 0) return false;
      depth -= 1;
    } else if (depth === 0) {
      if (separator !== '' && variants.startsWith(separator, i)) i += separator.length - 1;
      else if (!VARIANT_CHAIN_CHAR.test(ch)) return false;
    }
  }
  return depth === 0;
}

/** Strip the important `!` and the negative `-` markers from a bare utility. */
export function stripModifiers(utility: string): string {
  let rest = utility;
  if (rest.startsWith('!')) rest = rest.slice(1);
  if (rest.startsWith('-')) rest = rest.slice(1);
  return rest;
}

/** Strip variants (`md:hover:`), the important `!` and the negative `-` from a class. */
export function utilityPart(candidate: string, separator: string = DEFAULT_SEPARATOR): string {
  return stripModifiers(splitVariants(candidate, separator).utility);
}

/** `text-sm` → `text`, `px-4` → `px`, `flex` → `flex`. */
export function utilityRoot(utility: string): string {
  const idx = utility.indexOf('-');
  return idx === -1 ? utility : utility.slice(0, idx);
}

/** Roots of every class that produced CSS (used to extend the utility-like heuristic). */
export function collectRoots(
  classes: Iterable<string>,
  separator: string = DEFAULT_SEPARATOR,
): Set<string> {
  const roots = new Set<string>();
  for (const cls of classes) {
    const root = utilityRoot(utilityPart(cls, separator));
    if (root && !NUMBER_LIKE.test(root)) roots.add(root);
  }
  return roots;
}
