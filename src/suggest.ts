import { DEFAULT_SEPARATOR, splitVariants, utilityRoot } from './classify.js';
import { generate } from './generate.js';
import type { LoadedProject } from './project.js';

/** Flatten a theme section into `key` / `nested-key` strings (Tailwind's naming). */
export function flattenThemeKeys(section: unknown, prefix = ''): string[] {
  if (section === null || typeof section !== 'object' || Array.isArray(section)) return [];
  const keys: string[] = [];
  for (const [key, value] of Object.entries(section as Record<string, unknown>)) {
    // `acme.DEFAULT` is the class `text-acme`, already pushed by the parent level.
    if (key === 'DEFAULT' && prefix) continue;
    const name = prefix ? `${prefix}-${key}` : key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      const nested = value as Record<string, unknown>;
      if ('DEFAULT' in nested) keys.push(name);
      keys.push(...flattenThemeKeys(nested, name));
    } else {
      keys.push(name);
    }
  }
  return keys;
}

/**
 * Keys of every theme section whose key set differs from stock Tailwind — these are the
 * project's own tokens, i.e. the only place a replacement for a ghost can come from.
 */
export function changedThemeKeys(project: LoadedProject): string[] {
  const out = new Set<string>();
  const projectTheme = project.resolved.theme ?? {};
  const stockTheme = project.stockResolved.theme ?? {};
  for (const section of Object.keys(projectTheme)) {
    const mine = flattenThemeKeys(projectTheme[section]);
    const stock = new Set(flattenThemeKeys(stockTheme[section]));
    const differs = mine.length !== stock.size || mine.some((k) => !stock.has(k));
    if (differs) for (const k of mine) out.add(k);
  }
  return Array.from(out);
}

/** Real CSS properties set by a list of declarations (custom properties like `--tw-*` excluded). */
const propsOf = (decls: readonly string[]): string[] =>
  Array.from(new Set(decls.map((d) => d.slice(0, d.indexOf(':')).trim())))
    .filter((p) => !p.startsWith('--'))
    .sort();

const NUMERIC = /^-?\d+(\.\d+)?$/;

interface Shell {
  variants: string;
  bang: string;
  neg: string;
  utility: string;
}

/**
 * Split `md:hover:!-tw-m-4` into variants / `!` / `-` / `tw-m-4` (prefix is kept on the utility),
 * honouring the project's `separator` (`md_hover_!-tw-m-4` with `separator: '_'`).
 */
function splitShell(candidate: string, separator: string): Shell {
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

/**
 * For each ghost, find project classes with the same root that set the same CSS properties.
 * Returns ghost class → up to `limit` suggestions (variants / `!` / `-` re-attached).
 */
export async function suggestReplacements(
  project: LoadedProject,
  ghosts: ReadonlyArray<{ class: string; stockCss: readonly string[] }>,
  limit = 8,
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  if (ghosts.length === 0) return result;
  const prefix = project.resolved.prefix ?? '';
  const separator = project.resolved.separator ?? DEFAULT_SEPARATOR;
  const keys = changedThemeKeys(project);
  if (keys.length === 0) return result;

  // root (without prefix) → probe class names
  const roots = new Set<string>();
  const shells = new Map<string, Shell & { root: string; key: string }>();
  for (const ghost of ghosts) {
    const shell = splitShell(ghost.class, separator);
    const bare =
      prefix && shell.utility.startsWith(prefix)
        ? shell.utility.slice(prefix.length)
        : shell.utility;
    const root = utilityRoot(bare);
    if (!root) continue;
    roots.add(root);
    shells.set(ghost.class, { ...shell, root, key: bare.slice(root.length + 1) });
  }
  const probes: string[] = [];
  for (const root of roots) {
    for (const key of keys)
      probes.push(key === 'DEFAULT' ? `${prefix}${root}` : `${prefix}${root}-${key}`);
  }
  const generated = await generate(project, project.config, probes);

  for (const ghost of ghosts) {
    const shell = shells.get(ghost.class);
    if (!shell) continue;
    const wanted = propsOf(ghost.stockCss);
    if (wanted.length === 0) continue;
    const matches: Array<{ cls: string; key: string }> = [];
    for (const key of keys) {
      const cls = key === 'DEFAULT' ? `${prefix}${shell.root}` : `${prefix}${shell.root}-${key}`;
      const decls = generated.declarations.get(cls);
      if (!decls || decls.length === 0) continue;
      const have = propsOf(decls);
      // Same root + at least one shared real property = "the project's token for this job".
      if (have.some((p) => wanted.includes(p))) matches.push({ cls, key });
    }
    const ghostNum = NUMERIC.test(shell.key) ? Number(shell.key) : undefined;
    matches.sort((a, b) => {
      const an = NUMERIC.test(a.key) ? Number(a.key) : undefined;
      const bn = NUMERIC.test(b.key) ? Number(b.key) : undefined;
      if (ghostNum !== undefined && an !== undefined && bn !== undefined) {
        return Math.abs(an - ghostNum) - Math.abs(bn - ghostNum) || an - bn;
      }
      if (an !== undefined && bn !== undefined) return an - bn;
      if (an !== undefined) return -1;
      if (bn !== undefined) return 1;
      return a.cls.localeCompare(b.cls);
    });
    result.set(
      ghost.class,
      matches.slice(0, limit).map((m) => `${shell.variants}${shell.bang}${shell.neg}${m.cls}`),
    );
  }
  return result;
}
