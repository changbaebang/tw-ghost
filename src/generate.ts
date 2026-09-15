import selectorParser from 'postcss-selector-parser';
import type { LoadedProject, PostcssDecl, TailwindConfigObject } from './project.js';
import { unescapeCssIdentifier } from './unescape.js';

export interface GeneratedCss {
  /** every class name that appears in a selector of the generated CSS (unescaped) */
  classes: Set<string>;
  /** class name → declarations of the rules whose selector mentions it (deduped, in order) */
  declarations: Map<string, string[]>;
}

const INPUT_CSS = '@tailwind components; @tailwind utilities;';

export interface StockConfigOptions {
  /**
   * Screens for the stock run (`analyze` passes the default screens merged with the project's).
   * A responsive variant the project defines (`tablet:`) then resolves in the stock run too, and
   * `tablet:text-sm` lands in the stock set directly — as does `2xl:p-3` when the project removed
   * `2xl` by replacing `screens`.
   */
  screens?: unknown;
}

/**
 * Config for the STOCK run: same prefix/separator/important/darkMode as the project, default
 * theme (plus the project's screens when supplied), no plugins/presets/safelist/corePlugins/blocklist.
 */
export function stockConfigFrom(
  config: TailwindConfigObject,
  options: StockConfigOptions = {},
): TailwindConfigObject {
  const stock: Record<string, unknown> = {};
  for (const key of ['prefix', 'separator', 'important', 'darkMode', 'future', 'experimental']) {
    if (config[key] !== undefined) stock[key] = config[key];
  }
  if (options.screens !== undefined) stock.theme = { screens: options.screens };
  return stock as TailwindConfigObject;
}

/**
 * Tailwind prints "warn - No utility classes were detected in your source files" (plus a docs
 * URL, preceded by a blank line) whenever a run emits nothing — which for tw-ghost is the normal
 * case of every candidate being a ghost, and says nothing about the user's build. Only that
 * message is filtered; any other Tailwind warning still reaches stderr. `console.warn` is
 * restored afterwards even when the run throws.
 */
const SILENCED_FRAGMENTS = [
  'No utility classes were detected',
  'tailwindcss.com/docs/content-configuration',
];

async function withNoUtilityWarningFiltered<T>(fn: () => Promise<T>): Promise<T> {
  const original = console.warn;
  let pendingBlank = false;
  const flush = (): void => {
    if (pendingBlank) original.call(console, '');
    pendingBlank = false;
  };
  console.warn = (...args: unknown[]): void => {
    if (args.length === 1 && args[0] === '') {
      flush();
      pendingBlank = true;
      return;
    }
    const text = args.map(String).join(' ');
    if (SILENCED_FRAGMENTS.some((fragment) => text.includes(fragment))) {
      pendingBlank = false;
      return;
    }
    flush();
    original.apply(console, args);
  };
  try {
    return await fn();
  } finally {
    console.warn = original;
    flush();
  }
}

/** Run Tailwind over `candidates` (as raw content) with `config` and collect emitted classes. */
export async function generate(
  project: LoadedProject,
  config: TailwindConfigObject,
  candidates: Iterable<string>,
): Promise<GeneratedCss> {
  const raw = Array.from(candidates).join('\n');
  const runConfig: TailwindConfigObject = {
    ...config,
    content: { files: [{ raw, extension: 'html' }] },
  };
  const result = await withNoUtilityWarningFiltered(() =>
    project.postcss([project.tailwind(runConfig)]).process(INPUT_CSS, { from: undefined }),
  );
  return collectClasses(result.root);
}

export function collectClasses(root: {
  walkRules(
    cb: (rule: { selector: string; each(cb: (n: { type: string }) => void): void }) => void,
  ): void;
}): GeneratedCss {
  const classes = new Set<string>();
  const declarations = new Map<string, string[]>();
  const parser = selectorParser();
  root.walkRules((rule) => {
    const decls: string[] = [];
    rule.each((node) => {
      if (node.type === 'decl') {
        const d = node as PostcssDecl;
        decls.push(`${d.prop}: ${d.value}${d.important ? ' !important' : ''}`);
      }
    });
    let ast: ReturnType<typeof parser.astSync>;
    try {
      ast = parser.astSync(rule.selector);
    } catch {
      return;
    }
    const inThisRule = new Set<string>();
    ast.walkClasses((cls) => {
      const rawValue = (cls as unknown as { raws?: { value?: string } }).raws?.value;
      const name = rawValue !== undefined ? unescapeCssIdentifier(rawValue) : cls.value;
      classes.add(name);
      inThisRule.add(name);
    });
    for (const name of inThisRule) {
      const list = declarations.get(name) ?? [];
      for (const d of decls) if (!list.includes(d)) list.push(d);
      declarations.set(name, list);
    }
  });
  return { classes, declarations };
}
