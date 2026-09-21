import {
  DEFAULT_SEPARATOR,
  isPlausibleVariantChain,
  splitVariants,
  stripModifiers,
  utilityPart,
  utilityRoot,
} from './classify.js';
import { flattenThemeKeys } from './suggest.js';

const BLEND_MODES = [
  'normal',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'color-dodge',
  'color-burn',
  'hard-light',
  'soft-light',
  'difference',
  'exclusion',
  'hue',
  'saturation',
  'color',
  'luminosity',
  'plus-lighter',
];

/**
 * Value-taking Tailwind v3 core utilities: class prefix → the theme sections its values come
 * from and the keyword values it accepts on top. Longest prefix wins (`min-h-0` is `min-h`, not
 * `min`). Only existence of a key matters here, so sections that resolve to the same object
 * (`textColor` → `colors`) are listed under the name Tailwind reads.
 */
const VALUE_UTILITIES: Record<string, { theme?: string[]; words?: string[] }> = {
  // layout
  aspect: { theme: ['aspectRatio'] },
  columns: { theme: ['columns'] },
  'break-after': {
    words: ['auto', 'avoid', 'all', 'avoid-page', 'page', 'left', 'right', 'column'],
  },
  'break-before': {
    words: ['auto', 'avoid', 'all', 'avoid-page', 'page', 'left', 'right', 'column'],
  },
  'break-inside': { words: ['auto', 'avoid', 'avoid-page', 'avoid-column'] },
  'box-decoration': { words: ['clone', 'slice'] },
  box: { words: ['border', 'content'] },
  float: { words: ['right', 'left', 'none', 'start', 'end'] },
  clear: { words: ['left', 'right', 'both', 'none', 'start', 'end'] },
  isolation: { words: ['auto'] },
  object: { theme: ['objectPosition'], words: ['contain', 'cover', 'fill', 'none', 'scale-down'] },
  overflow: { words: ['auto', 'hidden', 'clip', 'visible', 'scroll'] },
  'overflow-x': { words: ['auto', 'hidden', 'clip', 'visible', 'scroll'] },
  'overflow-y': { words: ['auto', 'hidden', 'clip', 'visible', 'scroll'] },
  overscroll: { words: ['auto', 'contain', 'none'] },
  'overscroll-x': { words: ['auto', 'contain', 'none'] },
  'overscroll-y': { words: ['auto', 'contain', 'none'] },
  inset: { theme: ['inset'] },
  'inset-x': { theme: ['inset'] },
  'inset-y': { theme: ['inset'] },
  start: { theme: ['inset'] },
  end: { theme: ['inset'] },
  top: { theme: ['inset'] },
  right: { theme: ['inset'] },
  bottom: { theme: ['inset'] },
  left: { theme: ['inset'] },
  z: { theme: ['zIndex'] },
  // flexbox & grid
  basis: { theme: ['flexBasis'] },
  flex: {
    theme: ['flex'],
    words: ['row', 'row-reverse', 'col', 'col-reverse', 'wrap', 'wrap-reverse', 'nowrap'],
  },
  grow: { theme: ['flexGrow'] },
  shrink: { theme: ['flexShrink'] },
  order: { theme: ['order'] },
  'grid-cols': { theme: ['gridTemplateColumns'] },
  'grid-rows': { theme: ['gridTemplateRows'] },
  'grid-flow': { words: ['row', 'col', 'dense', 'row-dense', 'col-dense'] },
  col: { theme: ['gridColumn'] },
  'col-start': { theme: ['gridColumnStart'] },
  'col-end': { theme: ['gridColumnEnd'] },
  row: { theme: ['gridRow'] },
  'row-start': { theme: ['gridRowStart'] },
  'row-end': { theme: ['gridRowEnd'] },
  'auto-cols': { theme: ['gridAutoColumns'] },
  'auto-rows': { theme: ['gridAutoRows'] },
  gap: { theme: ['gap'] },
  'gap-x': { theme: ['gap'] },
  'gap-y': { theme: ['gap'] },
  justify: {
    words: ['normal', 'start', 'end', 'center', 'between', 'around', 'evenly', 'stretch'],
  },
  'justify-items': { words: ['start', 'end', 'center', 'stretch'] },
  'justify-self': { words: ['auto', 'start', 'end', 'center', 'stretch'] },
  content: {
    theme: ['content'],
    words: [
      'normal',
      'center',
      'start',
      'end',
      'between',
      'around',
      'evenly',
      'baseline',
      'stretch',
    ],
  },
  items: { words: ['start', 'end', 'center', 'baseline', 'stretch'] },
  self: { words: ['auto', 'start', 'end', 'center', 'stretch', 'baseline'] },
  'place-content': {
    words: ['center', 'start', 'end', 'between', 'around', 'evenly', 'baseline', 'stretch'],
  },
  'place-items': { words: ['start', 'end', 'center', 'baseline', 'stretch'] },
  'place-self': { words: ['auto', 'start', 'end', 'center', 'stretch'] },
  // spacing
  p: { theme: ['padding'] },
  px: { theme: ['padding'] },
  py: { theme: ['padding'] },
  ps: { theme: ['padding'] },
  pe: { theme: ['padding'] },
  pt: { theme: ['padding'] },
  pr: { theme: ['padding'] },
  pb: { theme: ['padding'] },
  pl: { theme: ['padding'] },
  m: { theme: ['margin'] },
  mx: { theme: ['margin'] },
  my: { theme: ['margin'] },
  ms: { theme: ['margin'] },
  me: { theme: ['margin'] },
  mt: { theme: ['margin'] },
  mr: { theme: ['margin'] },
  mb: { theme: ['margin'] },
  ml: { theme: ['margin'] },
  'space-x': { theme: ['space'], words: ['reverse'] },
  'space-y': { theme: ['space'], words: ['reverse'] },
  // sizing
  w: { theme: ['width'] },
  'min-w': { theme: ['minWidth'] },
  'max-w': { theme: ['maxWidth'] },
  h: { theme: ['height'] },
  'min-h': { theme: ['minHeight'] },
  'max-h': { theme: ['maxHeight'] },
  size: { theme: ['size'] },
  // typography
  font: { theme: ['fontFamily', 'fontWeight'] },
  text: {
    theme: ['fontSize', 'textColor'],
    words: [
      'left',
      'center',
      'right',
      'justify',
      'start',
      'end',
      'wrap',
      'nowrap',
      'balance',
      'pretty',
      'ellipsis',
      'clip',
    ],
  },
  tracking: { theme: ['letterSpacing'] },
  'line-clamp': { theme: ['lineClamp'], words: ['none'] },
  leading: { theme: ['lineHeight'] },
  'list-image': { theme: ['listStyleImage'] },
  list: { theme: ['listStyleType'], words: ['inside', 'outside', 'image-none'] },
  decoration: {
    theme: ['textDecorationColor', 'textDecorationThickness'],
    words: ['solid', 'double', 'dotted', 'dashed', 'wavy'],
  },
  'underline-offset': { theme: ['textUnderlineOffset'] },
  indent: { theme: ['textIndent'] },
  align: {
    words: ['baseline', 'top', 'middle', 'bottom', 'text-top', 'text-bottom', 'sub', 'super'],
  },
  whitespace: { words: ['normal', 'nowrap', 'pre', 'pre-line', 'pre-wrap', 'break-spaces'] },
  break: { words: ['normal', 'words', 'all', 'keep'] },
  hyphens: { words: ['none', 'manual', 'auto'] },
  // backgrounds
  bg: {
    theme: ['backgroundColor', 'backgroundImage', 'backgroundPosition', 'backgroundSize'],
    words: [
      'fixed',
      'local',
      'scroll',
      'clip-border',
      'clip-padding',
      'clip-content',
      'clip-text',
      'origin-border',
      'origin-padding',
      'origin-content',
      'repeat',
      'no-repeat',
      'repeat-x',
      'repeat-y',
      'repeat-round',
      'repeat-space',
    ],
  },
  from: { theme: ['gradientColorStops'] },
  via: { theme: ['gradientColorStops'] },
  to: { theme: ['gradientColorStops'] },
  // borders
  rounded: { theme: ['borderRadius'] },
  'rounded-s': { theme: ['borderRadius'] },
  'rounded-e': { theme: ['borderRadius'] },
  'rounded-t': { theme: ['borderRadius'] },
  'rounded-r': { theme: ['borderRadius'] },
  'rounded-b': { theme: ['borderRadius'] },
  'rounded-l': { theme: ['borderRadius'] },
  'rounded-ss': { theme: ['borderRadius'] },
  'rounded-se': { theme: ['borderRadius'] },
  'rounded-ee': { theme: ['borderRadius'] },
  'rounded-es': { theme: ['borderRadius'] },
  'rounded-tl': { theme: ['borderRadius'] },
  'rounded-tr': { theme: ['borderRadius'] },
  'rounded-br': { theme: ['borderRadius'] },
  'rounded-bl': { theme: ['borderRadius'] },
  border: {
    theme: ['borderWidth', 'borderColor'],
    words: ['solid', 'dashed', 'dotted', 'double', 'hidden', 'none', 'collapse', 'separate'],
  },
  'border-x': { theme: ['borderWidth', 'borderColor'] },
  'border-y': { theme: ['borderWidth', 'borderColor'] },
  'border-s': { theme: ['borderWidth', 'borderColor'] },
  'border-e': { theme: ['borderWidth', 'borderColor'] },
  'border-t': { theme: ['borderWidth', 'borderColor'] },
  'border-r': { theme: ['borderWidth', 'borderColor'] },
  'border-b': { theme: ['borderWidth', 'borderColor'] },
  'border-l': { theme: ['borderWidth', 'borderColor'] },
  'border-opacity': { theme: ['borderOpacity'] },
  'border-spacing': { theme: ['borderSpacing'] },
  'border-spacing-x': { theme: ['borderSpacing'] },
  'border-spacing-y': { theme: ['borderSpacing'] },
  divide: { theme: ['divideColor'], words: ['solid', 'dashed', 'dotted', 'double', 'none'] },
  'divide-x': { theme: ['divideWidth'], words: ['reverse'] },
  'divide-y': { theme: ['divideWidth'], words: ['reverse'] },
  'divide-opacity': { theme: ['divideOpacity'] },
  outline: {
    theme: ['outlineWidth', 'outlineColor'],
    words: ['none', 'dashed', 'dotted', 'double'],
  },
  'outline-offset': { theme: ['outlineOffset'] },
  ring: { theme: ['ringWidth', 'ringColor'], words: ['inset'] },
  'ring-offset': { theme: ['ringOffsetWidth', 'ringOffsetColor'] },
  'ring-opacity': { theme: ['ringOpacity'] },
  // effects
  shadow: { theme: ['boxShadow', 'boxShadowColor'] },
  opacity: { theme: ['opacity'] },
  'mix-blend': { words: BLEND_MODES },
  'bg-blend': { words: BLEND_MODES },
  // filters
  blur: { theme: ['blur'] },
  brightness: { theme: ['brightness'] },
  contrast: { theme: ['contrast'] },
  'drop-shadow': { theme: ['dropShadow'] },
  grayscale: { theme: ['grayscale'] },
  'hue-rotate': { theme: ['hueRotate'] },
  invert: { theme: ['invert'] },
  saturate: { theme: ['saturate'] },
  sepia: { theme: ['sepia'] },
  'backdrop-blur': { theme: ['backdropBlur'] },
  'backdrop-brightness': { theme: ['backdropBrightness'] },
  'backdrop-contrast': { theme: ['backdropContrast'] },
  'backdrop-grayscale': { theme: ['backdropGrayscale'] },
  'backdrop-hue-rotate': { theme: ['backdropHueRotate'] },
  'backdrop-invert': { theme: ['backdropInvert'] },
  'backdrop-opacity': { theme: ['backdropOpacity'] },
  'backdrop-saturate': { theme: ['backdropSaturate'] },
  'backdrop-sepia': { theme: ['backdropSepia'] },
  // tables
  table: { words: ['auto', 'fixed'] },
  caption: { words: ['top', 'bottom'] },
  // transitions & animation
  transition: { theme: ['transitionProperty'] },
  duration: { theme: ['transitionDuration'] },
  ease: { theme: ['transitionTimingFunction'] },
  delay: { theme: ['transitionDelay'] },
  animate: { theme: ['animation'] },
  // transforms
  scale: { theme: ['scale'] },
  'scale-x': { theme: ['scale'] },
  'scale-y': { theme: ['scale'] },
  rotate: { theme: ['rotate'] },
  'translate-x': { theme: ['translate'] },
  'translate-y': { theme: ['translate'] },
  'skew-x': { theme: ['skew'] },
  'skew-y': { theme: ['skew'] },
  origin: { theme: ['transformOrigin'] },
  transform: { words: ['gpu', 'none'] },
  // interactivity
  accent: { theme: ['accentColor'] },
  appearance: { words: ['none', 'auto'] },
  cursor: { theme: ['cursor'] },
  caret: { theme: ['caretColor'] },
  'pointer-events': { words: ['none', 'auto'] },
  resize: { words: ['none', 'x', 'y'] },
  scroll: { words: ['auto', 'smooth'] },
  'scroll-m': { theme: ['scrollMargin'] },
  'scroll-mx': { theme: ['scrollMargin'] },
  'scroll-my': { theme: ['scrollMargin'] },
  'scroll-ms': { theme: ['scrollMargin'] },
  'scroll-me': { theme: ['scrollMargin'] },
  'scroll-mt': { theme: ['scrollMargin'] },
  'scroll-mr': { theme: ['scrollMargin'] },
  'scroll-mb': { theme: ['scrollMargin'] },
  'scroll-ml': { theme: ['scrollMargin'] },
  'scroll-p': { theme: ['scrollPadding'] },
  'scroll-px': { theme: ['scrollPadding'] },
  'scroll-py': { theme: ['scrollPadding'] },
  'scroll-ps': { theme: ['scrollPadding'] },
  'scroll-pe': { theme: ['scrollPadding'] },
  'scroll-pt': { theme: ['scrollPadding'] },
  'scroll-pr': { theme: ['scrollPadding'] },
  'scroll-pb': { theme: ['scrollPadding'] },
  'scroll-pl': { theme: ['scrollPadding'] },
  snap: {
    words: ['start', 'end', 'center', 'align-none', 'normal', 'always', 'none', 'x', 'y', 'both'],
  },
  touch: {
    words: [
      'auto',
      'none',
      'pan-x',
      'pan-left',
      'pan-right',
      'pan-y',
      'pan-up',
      'pan-down',
      'pinch-zoom',
      'manipulation',
    ],
  },
  select: { words: ['none', 'text', 'all', 'auto'] },
  'will-change': { theme: ['willChange'] },
  // svg
  fill: { theme: ['fill'] },
  stroke: { theme: ['stroke', 'strokeWidth'] },
  // accessibility
  'forced-color-adjust': { words: ['auto', 'none'] },
};

/** Core utilities that take no value (so `md:flex` is utility-like, `flex-column` is not). */
const STATIC_UTILITIES = new Set<string>(
  (
    'container sr-only not-sr-only block inline-block inline flex inline-flex table inline-table ' +
    'table-caption table-cell table-column table-column-group table-footer-group table-header-group ' +
    'table-row-group table-row flow-root grid inline-grid contents list-item hidden isolate ' +
    'static fixed absolute relative sticky visible invisible collapse antialiased ' +
    'subpixel-antialiased italic not-italic normal-nums ordinal slashed-zero lining-nums ' +
    'oldstyle-nums proportional-nums tabular-nums diagonal-fractions stacked-fractions underline ' +
    'overline line-through no-underline uppercase lowercase capitalize normal-case truncate ' +
    'border-collapse border-separate transform transform-gpu transform-none resize ' +
    'snap-mandatory snap-proximity snap-none rounded border divide-x divide-y outline ring ' +
    'ring-inset shadow blur grayscale invert sepia drop-shadow backdrop-blur backdrop-grayscale ' +
    'backdrop-invert backdrop-sepia transition'
  ).split(' '),
);

/** Values any utility accepts (or that are so common a typo next to them is worth showing). */
const GENERIC_VALUES = new Set<string>([
  'auto',
  'full',
  'none',
  'px',
  'screen',
  'min',
  'max',
  'fit',
  'inherit',
  'current',
  'transparent',
  'initial',
]);

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

const NUMBER_LIKE = /^-?\d+(\.\d+)?%?$/;
const FRACTION_LIKE = /^\d+\/\d+$/;
/** A bare utility must contain a dash (`text-smm`, `w-[13px]`); a lone word (`flex`) is not utility-like. */
const BARE_UTILITY_SHAPE = /^!?-?[a-z][a-z0-9-]*-[^\s]+$/;
/** Under a variant chain the prefix check does the work, so `md:flex` is allowed through. */
const VARIANT_UTILITY_SHAPE = /^!?-?[a-z][^\s]*$/;

/**
 * What a utility name may be made of, outside `[...]`: lowercase, digits, `-`, `.`, `/`, `%`.
 * Inside brackets anything goes except a template-literal hole (`${`). Rejects the extractor's
 * punctuation tails (`px-16)`, `gap-4.`, `text-black,`), prose glued to a class, `·` joins,
 * uppercase (`block-A`) and unbalanced brackets (`after:content-[`).
 */
function hasClassShape(utility: string): boolean {
  let depth = 0;
  for (let i = 0; i < utility.length; i += 1) {
    const ch = utility[i] as string;
    if (ch === '[') depth += 1;
    else if (ch === ']') {
      if (depth === 0) return false;
      depth -= 1;
    } else if (depth > 0) {
      if (ch === '$' && utility[i + 1] === '{') return false;
    } else if (!/[a-z0-9\-./%]/.test(ch)) return false;
  }
  if (depth !== 0) return false;
  return !/[-./]$/.test(utility);
}

const isArbitrary = (value: string): boolean =>
  value.length > 2 && value.startsWith('[') && value.endsWith(']');

/** Levenshtein distance ≤ 1 (one insertion, deletion or substitution). */
export function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (a.length > b.length) i += 1;
    else if (a.length < b.length) j += 1;
    else {
      i += 1;
      j += 1;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/**
 * What the `--unknown` heuristic knows about the project: for each utility prefix (or, for
 * plugin utilities outside the core table, each root), the values that exist — theme keys of
 * the sections that prefix reads, its keyword values, and every value observed in the CSS the
 * two generation runs produced. Build it once per run with `buildUtilityVocabulary`.
 */
export interface UtilityVocabulary {
  values: Map<string, Set<string>>;
  /** Roots seen in generated CSS that are not core prefixes (custom plugin utilities). */
  roots: Set<string>;
  /** Keys accepted as a `/modifier` (opacity, line-height). */
  modifiers: Set<string>;
  /** The project's class `prefix` (`tw-`), stripped before the prefix / value split. */
  prefix: string;
}

export interface VocabularyOptions {
  /** Resolved themes to read section keys from (project first, then stock). */
  themes?: ReadonlyArray<Record<string, unknown> | undefined> | undefined;
  /** Classes the generation runs produced CSS for (their values extend the vocabulary). */
  classes?: Iterable<string> | undefined;
  separator?: string | undefined;
  /** The project's `prefix` option (`tw-`). */
  prefix?: string | undefined;
}

/** Longest core prefix `utility` starts with (`min-h-0` → `min-h`), or `undefined`. */
export function matchUtilityPrefix(utility: string): string | undefined {
  let best: string | undefined;
  for (const prefix of Object.keys(VALUE_UTILITIES)) {
    if (utility === prefix || utility.startsWith(`${prefix}-`)) {
      if (best === undefined || prefix.length > best.length) best = prefix;
    }
  }
  return best;
}

/** Split a utility into the prefix its values belong to and the value: `min-h-0` → `min-h`, `0`. */
function splitPrefix(utility: string): { prefix: string; value: string; core: boolean } {
  const core = matchUtilityPrefix(utility);
  if (core !== undefined) {
    return { prefix: core, value: utility.slice(core.length + 1), core: true };
  }
  const root = utilityRoot(utility);
  return { prefix: root, value: utility.slice(root.length + 1), core: false };
}

const asRecord = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/** Strip the project's class prefix (`tw-text-sm` → `text-sm`) when present. */
const unprefix = (utility: string, prefix: string): string =>
  prefix !== '' && utility.startsWith(prefix) ? utility.slice(prefix.length) : utility;

export function buildUtilityVocabulary(options: VocabularyOptions = {}): UtilityVocabulary {
  const themes = options.themes ?? [];
  const separator = options.separator ?? DEFAULT_SEPARATOR;
  const prefix = options.prefix ?? '';
  const values = new Map<string, Set<string>>();
  const add = (prefix: string, value: string): void => {
    if (value === '') return;
    let set = values.get(prefix);
    if (!set) {
      set = new Set();
      values.set(prefix, set);
    }
    set.add(value);
  };
  for (const [prefix, spec] of Object.entries(VALUE_UTILITIES)) {
    for (const word of spec.words ?? []) add(prefix, word);
    for (const theme of themes) {
      for (const section of spec.theme ?? []) {
        for (const key of flattenThemeKeys(asRecord(theme)[section])) add(prefix, key);
      }
    }
  }
  const modifiers = new Set<string>();
  for (const theme of themes) {
    for (const section of ['opacity', 'lineHeight']) {
      for (const key of flattenThemeKeys(asRecord(theme)[section])) modifiers.add(key);
    }
  }
  const roots = new Set<string>();
  for (const cls of options.classes ?? []) {
    const utility = unprefix(utilityPart(cls, separator), prefix);
    // `flex` / `hidden` say nothing about values and would make `grid-2` / `block-1` look real.
    if (STATIC_UTILITIES.has(utility)) continue;
    const split = splitPrefix(utility);
    if (split.prefix === '' || split.value === '' || NUMBER_LIKE.test(split.prefix)) continue;
    if (!split.core) roots.add(split.prefix);
    add(split.prefix, split.value);
  }
  return { values, roots, modifiers, prefix };
}

/** First dash-separated segment of a value (`red-500` → `red`). */
const head = (value: string): string => value.split('-', 1)[0] ?? value;

/**
 * Whether `value` could be a value of `prefix`: numeric / fraction / arbitrary, a generic
 * keyword, a known value (theme key, keyword, observed), one edit away from a known value
 * (`xll` → `xl`, `mm` → `m`), or the head of a known nested key (`red` when `red-500` exists —
 * the parent was dropped or never existed).
 */
function isValueLike(prefix: string, value: string, vocab: UtilityVocabulary): boolean {
  if (NUMBER_LIKE.test(value) || FRACTION_LIKE.test(value) || isArbitrary(value)) return true;
  if (GENERIC_VALUES.has(value)) return true;
  const known = vocab.values.get(prefix);
  if (!known) return false;
  if (known.has(value)) return true;
  if (value.length < 2) return false;
  const valueHead = head(value);
  for (const k of known) {
    if (withinOneEdit(value, k)) return true;
    if (k.length > valueHead.length && k.startsWith(`${valueHead}-`)) return true;
  }
  return false;
}

/** Split `red-500/50` into `red-500` and `50` (only a `/` outside brackets counts). */
function splitModifier(value: string): { base: string; modifier: string | undefined } {
  let depth = 0;
  for (let i = value.length - 1; i >= 0; i -= 1) {
    const ch = value[i];
    if (ch === ']') depth += 1;
    else if (ch === '[') depth -= 1;
    else if (ch === '/' && depth === 0) {
      return { base: value.slice(0, i), modifier: value.slice(i + 1) };
    }
  }
  return { base: value, modifier: undefined };
}

/**
 * Heuristic behind `--unknown`: keep a candidate only if it is shaped like a class, its prefix is
 * a Tailwind utility (core table, or a root the generated CSS proved to exist), and what follows
 * looks like a value that utility could take (see `isValueLike`). `my-page`, `no-op`,
 * `bottom-start` and `box-center` fail the value check; `text-mm`, `px-13`, `rounded-xll` and
 * `gap-2.5` (when spacing lacks `2.5`) pass.
 */
export function looksUtilityLike(
  candidate: string,
  vocab: UtilityVocabulary,
  separator: string = DEFAULT_SEPARATOR,
): boolean {
  if (NON_UTILITY_PREFIXES.some((p) => candidate.startsWith(p))) return false;
  // `max-h-` / `before:content-` are template-literal stubs (`max-h-${x}`), never a real class.
  if (candidate.endsWith('-') || candidate.endsWith(separator)) return false;
  const { variants, utility } = splitVariants(candidate, separator);
  if (variants !== '' && !isPlausibleVariantChain(variants, separator)) return false;
  const shape = variants === '' ? BARE_UTILITY_SHAPE : VARIANT_UTILITY_SHAPE;
  if (!shape.test(utility)) return false;
  const bare = unprefix(stripModifiers(utility), vocab.prefix);
  if (!hasClassShape(bare)) return false;
  if (STATIC_UTILITIES.has(bare)) return true;
  const { prefix, value, core } = splitPrefix(bare);
  if (prefix === '' || NUMBER_LIKE.test(prefix)) return false;
  if (!core && !vocab.roots.has(prefix)) return false;
  // `max-h` / `space-y` alone: a stub or prose, not a class (the bare forms that are classes,
  // such as `rounded` / `border`, are in `STATIC_UTILITIES`).
  if (value === '') return false;
  const { base, modifier } = splitModifier(value);
  if (modifier !== undefined) {
    const modifierOk =
      NUMBER_LIKE.test(modifier) || isArbitrary(modifier) || vocab.modifiers.has(modifier);
    if (!modifierOk || base === '') return false;
    return isValueLike(prefix, base, vocab);
  }
  return isValueLike(prefix, value, vocab);
}
