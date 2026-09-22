/**
 * ESLint plugin (flat config) for tw-ghost.
 *
 *   import twGhost from 'tw-ghost/eslint';
 *   export default [twGhost.configs.recommended];
 *
 * One rule, `tw-ghost/no-ghost-class`: every class in a `className` / `class` attribute or in a
 * `clsx()`-style call that produces no CSS in the project's Tailwind config but would in stock
 * Tailwind is reported, with the CSS it would have produced. Verdicts come from the same engine as
 * the CLI (`createLiveClassifier`), so the editor and CI agree.
 *
 * The plugin has no dependency on ESLint: rules are plain objects and the AST node shapes used
 * below are the ESTree/JSX subset every ESLint parser produces.
 */
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { TwGhostConfigError } from './errors.js';
import { createLiveClassifier, type LiveClassifier } from './live.js';
import { findConfig } from './project.js';
import { VERSION } from './version.js';

// ---- minimal AST types (ESTree + JSX), enough for what the rule reads --------------------------

interface Node {
  type: string;
  range?: [number, number];
  loc?: { start: { line: number; column: number }; end: { line: number; column: number } };
}
interface Literal extends Node {
  type: 'Literal';
  value: unknown;
  raw?: string;
}
interface TemplateElement extends Node {
  type: 'TemplateElement';
  value: { raw: string; cooked: string | null };
}
interface TemplateLiteral extends Node {
  type: 'TemplateLiteral';
  quasis: TemplateElement[];
  expressions: Node[];
}
interface JSXAttribute extends Node {
  type: 'JSXAttribute';
  name: { type: string; name?: string };
  value: Node | null;
}
interface JSXExpressionContainer extends Node {
  type: 'JSXExpressionContainer';
  expression: Node;
}
interface CallExpression extends Node {
  type: 'CallExpression';
  callee: Node & { name?: string; property?: Node & { name?: string }; object?: Node };
  arguments: Node[];
}
interface ConditionalExpression extends Node {
  type: 'ConditionalExpression';
  consequent: Node;
  alternate: Node;
}
interface LogicalExpression extends Node {
  type: 'LogicalExpression';
  right: Node;
}
interface ArrayExpression extends Node {
  type: 'ArrayExpression';
  elements: (Node | null)[];
}
interface ObjectExpression extends Node {
  type: 'ObjectExpression';
  properties: Node[];
}
interface Property extends Node {
  type: 'Property';
  key: Node;
  computed: boolean;
}

interface RuleContext {
  filename?: string;
  getFilename?: () => string;
  cwd?: string;
  getCwd?: () => string;
  options: unknown[];
  report(descriptor: {
    node?: Node;
    loc?: NonNullable<Node['loc']>;
    messageId: string;
    data?: Record<string, string>;
  }): void;
}

export interface NoGhostClassOptions {
  /** Path to tailwind.config.*; default: nearest walking up from the linted file. */
  config?: string;
  /** Call names whose string arguments hold classes. Default: clsx, cx, cn, classnames, classNames, cva, tv, twMerge, twJoin. */
  callees?: string[];
  /** JSX attribute names to scan. Default: className, class. */
  attributes?: string[];
  /** Also report `unknown-variant` (a valid utility under a variant this config does not know). Default: false. */
  reportUnknownVariant?: boolean;
  /** Also report `unknown` classes that look like utilities (typos). Off by default: noisy. */
  reportUnknown?: boolean;
  /** Class names matching any of these regexes are skipped. */
  ignore?: string[];
}

const DEFAULT_CALLEES = [
  'clsx',
  'cx',
  'cn',
  'classnames',
  'classNames',
  'cva',
  'tv',
  'twMerge',
  'twJoin',
];
const DEFAULT_ATTRIBUTES = ['className', 'class'];

// ---- classifier cache ---------------------------------------------------------------------------

interface CacheEntry {
  classifier: LiveClassifier;
  mtimeMs: number;
  error?: undefined;
}
interface CacheError {
  classifier?: undefined;
  mtimeMs: number;
  error: string;
}
const classifiers = new Map<string, CacheEntry | CacheError>();
const configByDir = new Map<string, string | null>();

function resolveConfigPath(file: string, explicit: string | undefined, cwd: string): string | null {
  if (explicit) return path.resolve(cwd, explicit);
  const dir = path.dirname(file);
  const cached = configByDir.get(dir);
  if (cached !== undefined) return cached;
  const found = findConfig(dir) ?? null;
  configByDir.set(dir, found);
  return found;
}

function classifierFor(configPath: string): CacheEntry | CacheError {
  const mtimeMs = existsSync(configPath) ? statSync(configPath).mtimeMs : -1;
  const hit = classifiers.get(configPath);
  if (hit && hit.mtimeMs === mtimeMs) return hit;
  let entry: CacheEntry | CacheError;
  try {
    entry = { classifier: createLiveClassifier(configPath), mtimeMs };
  } catch (error) {
    const message = error instanceof TwGhostConfigError ? error.message : String(error);
    entry = { mtimeMs, error: message };
  }
  classifiers.set(configPath, entry);
  return entry;
}

/** Drop every cached classifier (tests, or after a dependency change). */
export function resetEslintCache(): void {
  classifiers.clear();
  configByDir.clear();
}

// ---- the rule -----------------------------------------------------------------------------------

const WHITESPACE = /\s+/;

/** Tokens of a class string with their offsets inside the string. */
function tokens(text: string): { token: string; offset: number }[] {
  const out: { token: string; offset: number }[] = [];
  let i = 0;
  for (const part of text.split(WHITESPACE)) {
    const idx = text.indexOf(part, i);
    if (part !== '') out.push({ token: part, offset: idx });
    i = idx + part.length;
  }
  return out;
}

export const noGhostClass = {
  meta: {
    type: 'problem' as const,
    docs: {
      description:
        'Disallow Tailwind classes that produce no CSS in this project config (replaced theme scales, removed keys).',
      recommended: true,
      url: 'https://github.com/changbaebang/tw-ghost#eslint',
    },
    schema: [
      {
        type: 'object',
        properties: {
          config: { type: 'string' },
          callees: { type: 'array', items: { type: 'string' } },
          attributes: { type: 'array', items: { type: 'string' } },
          reportUnknownVariant: { type: 'boolean' },
          reportUnknown: { type: 'boolean' },
          ignore: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      ghost:
        '`{{cls}}` produces no CSS in this Tailwind config (stock Tailwind would set {{css}}). Replace it with a project token or remove it.',
      ghostNoCss:
        '`{{cls}}` produces no CSS in this Tailwind config but would in stock Tailwind. Replace it with a project token or remove it.',
      unknownVariant:
        '`{{cls}}`: the utility exists in this config but the variant chain is not one it knows.',
      unknown:
        '`{{cls}}` looks like a Tailwind utility but produces no CSS in stock Tailwind or this config (typo?).',
      setup: 'tw-ghost could not load the Tailwind config: {{message}}',
      noConfig:
        'tw-ghost found no tailwind.config.{ts,js,cjs,mjs} walking up from this file; set the rule option `config`.',
    },
  },

  create(context: RuleContext) {
    const options = (context.options[0] ?? {}) as NoGhostClassOptions;
    const filename = context.filename ?? context.getFilename?.() ?? '';
    const cwd = context.cwd ?? context.getCwd?.() ?? process.cwd();
    const callees = new Set(options.callees ?? DEFAULT_CALLEES);
    const attributes = new Set(options.attributes ?? DEFAULT_ATTRIBUTES);
    const ignore = (options.ignore ?? []).map((p) => new RegExp(p));

    const configPath = resolveConfigPath(filename, options.config, cwd);
    let reportedSetup = false;
    const reportSetupOnce = (node: Node, messageId: 'setup' | 'noConfig', message = ''): void => {
      if (reportedSetup) return;
      reportedSetup = true;
      context.report({ node, messageId, data: { message } });
    };

    // A string can be reached twice (a clsx() call inside className={…} is seen by both the
    // attribute walk and the CallExpression visitor); judge each string node once.
    const judged = new WeakSet<Node>();
    const judge = (node: Node, text: string, textStartOffset: number): void => {
      if (judged.has(node)) return;
      judged.add(node);
      if (!configPath) {
        reportSetupOnce(node, 'noConfig');
        return;
      }
      const entry = classifierFor(configPath);
      if (entry.error !== undefined) {
        reportSetupOnce(node, 'setup', entry.error);
        return;
      }
      const live = entry.classifier;
      for (const { token, offset } of tokens(text)) {
        if (ignore.some((re) => re.test(token))) continue;
        const verdict = live.classify(token);
        let messageId: string | null = null;
        const data: Record<string, string> = { cls: token };
        if (verdict === 'ghost') {
          const css = live.stockDeclarations(token);
          messageId = css.length > 0 ? 'ghost' : 'ghostNoCss';
          data.css = css.join('; ');
        } else if (verdict === 'unknown-variant' && options.reportUnknownVariant) {
          messageId = 'unknownVariant';
        } else if (verdict === 'unknown' && options.reportUnknown) {
          messageId = 'unknown';
        }
        if (!messageId) continue;
        // Point at the token itself when the node has a range and the string is a single line.
        const loc = node.loc;
        if (loc && node.range && loc.start.line === loc.end.line) {
          const col = loc.start.column + textStartOffset + offset;
          context.report({
            loc: {
              start: { line: loc.start.line, column: col },
              end: { line: loc.start.line, column: col + token.length },
            },
            messageId,
            data,
          });
        } else {
          context.report({ node, messageId, data });
        }
      }
    };

    /** Judge every static string inside an expression that feeds a class list. */
    const visitValue = (node: Node | null | undefined): void => {
      if (!node) return;
      switch (node.type) {
        case 'Literal': {
          const lit = node as Literal;
          if (typeof lit.value === 'string') judge(node, lit.value, 1); // 1 = opening quote
          return;
        }
        case 'TemplateLiteral': {
          const tl = node as TemplateLiteral;
          for (const q of tl.quasis) {
            const text = q.value.cooked ?? q.value.raw;
            judge(q, text, 1); // 1 = backtick or closing `}`
          }
          return;
        }
        case 'JSXExpressionContainer':
          visitValue((node as JSXExpressionContainer).expression);
          return;
        case 'ConditionalExpression': {
          const c = node as ConditionalExpression;
          visitValue(c.consequent);
          visitValue(c.alternate);
          return;
        }
        case 'LogicalExpression':
          visitValue((node as LogicalExpression).right);
          return;
        case 'ArrayExpression':
          for (const el of (node as ArrayExpression).elements) visitValue(el);
          return;
        case 'ObjectExpression':
          // clsx({ 'text-sm': cond }) — keys are classes
          for (const p of (node as ObjectExpression).properties) {
            if (p.type === 'Property' && !(p as Property).computed) visitValue((p as Property).key);
          }
          return;
        case 'CallExpression': {
          const call = node as CallExpression;
          if (isClassCallee(call)) for (const a of call.arguments) visitValue(a);
          return;
        }
        default:
          return;
      }
    };

    const isClassCallee = (call: CallExpression): boolean => {
      const c = call.callee;
      if (c.type === 'Identifier' && c.name) return callees.has(c.name);
      if (c.type === 'MemberExpression' && c.property?.name) return callees.has(c.property.name);
      return false;
    };

    return {
      JSXAttribute(node: JSXAttribute) {
        const name = node.name.name;
        if (!name || !attributes.has(name)) return;
        visitValue(node.value);
      },
      CallExpression(node: CallExpression) {
        if (isClassCallee(node)) for (const a of node.arguments) visitValue(a);
      },
    };
  },
};

const plugin = {
  meta: { name: 'tw-ghost', version: VERSION },
  rules: { 'no-ghost-class': noGhostClass },
  configs: {} as { recommended: unknown },
};

plugin.configs.recommended = {
  name: 'tw-ghost/recommended',
  plugins: { 'tw-ghost': plugin },
  rules: { 'tw-ghost/no-ghost-class': 'error' },
};

export default plugin;
