import path from 'node:path';
import {
  DEFAULT_SEPARATOR,
  isPlausibleVariantChain,
  splitVariants,
  type Verdict,
} from './classify.js';
import { TwGhostConfigError } from './errors.js';
import { stockConfigFrom } from './generate.js';
import { type LoadedProject, type LoadProjectOptions, loadProject } from './project.js';

/**
 * A synchronous, per-candidate classifier on top of Tailwind's JIT engine.
 *
 * `analyze()` generates CSS for a whole file set through postcss, which is async. Editors and
 * ESLint rules need an answer per class name, synchronously, thousands of times per second.
 * Tailwind v3 exposes exactly that internally: `createContext(resolvedConfig)` builds the JIT
 * context once (~20 ms) and `generateRules(candidates, context)` returns the rules a set of
 * candidates would produce — no postcss, no I/O. Two contexts (project and stock) give the same
 * verdict `analyze()` computes from generated CSS.
 *
 * The engine is loaded from the project's own `tailwindcss` (same resolution rules as the CLI),
 * so verdicts match the project's build. Internal module paths are pinned per Tailwind 3.x and
 * verified at load time; an unsupported layout fails with a clear error instead of a wrong answer.
 */
export interface LiveClassifier {
  project: LoadedProject;
  separator: string;
  /** Same verdicts as the CLI: `ok` | `ghost` | `unknown-variant` | `unknown`. Memoized. */
  classify(candidate: string): Verdict;
  /** The declarations `candidate` produces in stock Tailwind (empty when none): the "what you lost" hint. */
  stockDeclarations(candidate: string): string[];
  /** Drop the memo (call after the config file changes). */
  reset(): void;
}

type JitContext = unknown;
type Rule = [unknown, { toString(): string; nodes?: unknown[] }];
interface JitEngine {
  createContext(resolved: unknown): JitContext;
  generateRules(candidates: Set<string>, context: JitContext): Rule[];
}

function loadEngine(project: LoadedProject): JitEngine {
  const lib = path.join(project.tailwindPackageDir, 'lib', 'lib');
  let ctxMod: { createContext?: unknown };
  let genMod: { generateRules?: unknown };
  try {
    ctxMod = project.require(path.join(lib, 'setupContextUtils.js')) as typeof ctxMod;
    genMod = project.require(path.join(lib, 'generateRules.js')) as typeof genMod;
  } catch (error) {
    throw new TwGhostConfigError(
      `tailwindcss ${project.tailwindVersion} at ${project.tailwindPackageDir} does not expose the JIT internals (lib/lib/setupContextUtils.js, lib/lib/generateRules.js) that the live classifier needs: ${(error as Error).message}`,
    );
  }
  if (typeof ctxMod.createContext !== 'function' || typeof genMod.generateRules !== 'function') {
    throw new TwGhostConfigError(
      `tailwindcss ${project.tailwindVersion}: unexpected JIT internals (createContext / generateRules missing); the live classifier supports tailwindcss 3.3.x – 3.4.x.`,
    );
  }
  return {
    createContext: ctxMod.createContext as JitEngine['createContext'],
    generateRules: genMod.generateRules as JitEngine['generateRules'],
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

/** Declarations of the rules a candidate produced, as `prop: value` strings in order, deduped. */
function declarationsOf(rules: Rule[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const walk = (node: unknown): void => {
    const n = node as { type?: string; prop?: string; value?: string; nodes?: unknown[] };
    if (n.type === 'decl' && n.prop !== undefined) {
      const text = `${n.prop}: ${n.value ?? ''}`;
      if (!seen.has(text)) {
        seen.add(text);
        out.push(text);
      }
    }
    for (const child of n.nodes ?? []) walk(child);
  };
  for (const [, rule] of rules) walk(rule);
  return out;
}

export interface CreateLiveClassifierOptions extends LoadProjectOptions {
  /** An already loaded project (skips `loadProject`). */
  project?: LoadedProject | undefined;
}

/**
 * Build a live classifier for a config file. Loading the project and the two JIT contexts costs
 * tens of milliseconds; keep the instance and reuse it across files.
 */
export function createLiveClassifier(
  configPath: string,
  options: CreateLiveClassifierOptions = {},
): LiveClassifier {
  const project = options.project ?? loadProject(configPath, options);
  const engine = loadEngine(project);
  const separator = project.resolved.separator ?? DEFAULT_SEPARATOR;

  const projectContext = engine.createContext(project.resolved);
  // Stock run: default theme plus the project's screens (so custom breakpoints resolve), same
  // prefix/separator/important/darkMode — identical to what `analyze()` compares against.
  const stockScreens = {
    ...asRecord(project.stockResolved.theme?.screens),
    ...asRecord(project.resolved.theme?.screens),
  };
  const stockConfig = stockConfigFrom(project.config, { screens: stockScreens });
  const resolveConfig = project.require(
    path.join(project.tailwindPackageDir, 'resolveConfig.js'),
  ) as (c: unknown) => unknown;
  const stockContext = engine.createContext(resolveConfig(stockConfig));

  const producesIn = (context: JitContext, candidate: string): boolean =>
    engine.generateRules(new Set([candidate]), context).length > 0;

  const memo = new Map<string, Verdict>();
  const classify = (candidate: string): Verdict => {
    const cached = memo.get(candidate);
    if (cached !== undefined) return cached;
    let verdict: Verdict;
    if (producesIn(projectContext, candidate)) verdict = 'ok';
    else if (producesIn(stockContext, candidate)) verdict = 'ghost';
    else {
      verdict = 'unknown';
      const { variants, utility } = splitVariants(candidate, separator);
      if (variants !== '' && utility !== '' && isPlausibleVariantChain(variants, separator)) {
        if (producesIn(projectContext, utility)) verdict = 'unknown-variant';
        else if (producesIn(stockContext, utility)) verdict = 'ghost';
      }
    }
    memo.set(candidate, verdict);
    return verdict;
  };

  return {
    project,
    separator,
    classify,
    stockDeclarations: (candidate) =>
      declarationsOf(engine.generateRules(new Set([candidate]), stockContext)),
    reset: () => memo.clear(),
  };
}
