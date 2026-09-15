import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { TwGhostConfigError } from './errors.js';

export const CONFIG_FILE_NAMES = [
  'tailwind.config.ts',
  'tailwind.config.js',
  'tailwind.config.cjs',
  'tailwind.config.mjs',
] as const;

/** Walk up from `cwd` looking for a tailwind.config.{ts,js,cjs,mjs}. */
export function findConfig(cwd: string): string | undefined {
  let dir = path.resolve(cwd);
  for (;;) {
    for (const name of CONFIG_FILE_NAMES) {
      const candidate = path.join(dir, name);
      if (existsSync(candidate)) return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/** Throws unless the version is a Tailwind v3 release. */
export function assertTailwindV3(version: string): void {
  const major = Number.parseInt(version.split('.')[0] ?? '', 10);
  if (major !== 3) {
    throw new TwGhostConfigError(
      [
        `tw-ghost supports Tailwind CSS v3 only (found ${version}).`,
        'Tailwind v4 is CSS-first and does not use a JS config; the v3 generation model this tool relies on does not apply.',
      ].join(' '),
    );
  }
}

export type TailwindConfigObject = Record<string, unknown> & {
  content?: unknown;
  theme?: Record<string, unknown>;
  prefix?: string;
  separator?: string;
  important?: boolean | string;
  darkMode?: unknown;
  plugins?: unknown[];
  presets?: unknown[];
  safelist?: unknown[];
  corePlugins?: unknown;
  blocklist?: unknown[];
  future?: unknown;
  experimental?: unknown;
};

export type ResolvedTailwindConfig = TailwindConfigObject & {
  theme: Record<string, unknown>;
  prefix: string;
  separator: string;
};

export type TailwindPlugin = (config: TailwindConfigObject) => unknown;

export interface LoadedProject {
  configPath: string;
  configDir: string;
  tailwindVersion: string;
  tailwindEntry: string;
  /** The config exactly as exported by the file (after jiti/TS transform). */
  config: TailwindConfigObject;
  /** `resolveConfig(config)` using the project's Tailwind. */
  resolved: ResolvedTailwindConfig;
  /** `resolveConfig({})` — the stock resolved config for the same Tailwind version. */
  stockResolved: ResolvedTailwindConfig;
  tailwind: TailwindPlugin;
  postcss: PostcssModule;
  /** `require` bound to the config file (resolves the project's packages). */
  require: NodeRequire;
}

export type PostcssModule = (plugins: unknown[]) => {
  process(css: string, opts: { from?: string | undefined }): Promise<{ root: PostcssRoot }>;
};

export interface PostcssDecl {
  type: 'decl';
  prop: string;
  value: string;
  important: boolean;
}
export interface PostcssRule {
  type: 'rule';
  selector: string;
  nodes?: Array<PostcssDecl | { type: string }>;
  each(cb: (node: PostcssDecl | { type: string }) => void): void;
}
export interface PostcssRoot {
  walkRules(cb: (rule: PostcssRule) => void): void;
}

function resolveFrom(req: NodeRequire, id: string): string | undefined {
  try {
    return req.resolve(id);
  } catch {
    return undefined;
  }
}

/**
 * Load a Tailwind v3 config using the *project's* own tailwindcss/postcss installation,
 * resolved relative to the config file.
 */
export function loadProject(configPathInput: string): LoadedProject {
  const configPath = path.resolve(configPathInput);
  if (!existsSync(configPath)) {
    throw new TwGhostConfigError(`Config file not found: ${configPath}`);
  }
  const req = createRequire(configPath);

  const pkgJsonPath = resolveFrom(req, 'tailwindcss/package.json');
  if (!pkgJsonPath) {
    throw new TwGhostConfigError(
      [
        `Could not resolve "tailwindcss" from ${path.dirname(configPath)}.`,
        'Install tailwindcss (v3) in the project that owns the config file.',
      ].join(' '),
    );
  }
  const tailwindVersion = String((req(pkgJsonPath) as { version: string }).version);
  assertTailwindV3(tailwindVersion);

  const tailwindEntry = req.resolve('tailwindcss');
  const tailwind = req('tailwindcss') as TailwindPlugin;
  const loadConfigMod = req('tailwindcss/loadConfig') as
    | ((p: string) => TailwindConfigObject)
    | { default: (p: string) => TailwindConfigObject };
  const loadConfig = typeof loadConfigMod === 'function' ? loadConfigMod : loadConfigMod.default;
  const resolveConfigMod = req('tailwindcss/resolveConfig') as
    | ((c: TailwindConfigObject) => ResolvedTailwindConfig)
    | { default: (c: TailwindConfigObject) => ResolvedTailwindConfig };
  const resolveConfig =
    typeof resolveConfigMod === 'function' ? resolveConfigMod : resolveConfigMod.default;

  // Prefer the project's postcss; fall back to the one tailwindcss itself depends on.
  const postcssPath =
    resolveFrom(req, 'postcss') ?? createRequire(tailwindEntry).resolve('postcss');
  const postcss = req(postcssPath) as PostcssModule;

  let config: TailwindConfigObject;
  try {
    config = loadConfig(configPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new TwGhostConfigError(`Failed to load ${configPath}: ${message}`);
  }
  if (!config || typeof config !== 'object') {
    throw new TwGhostConfigError(`${configPath} did not export a config object.`);
  }

  return {
    configPath,
    configDir: path.dirname(configPath),
    tailwindVersion,
    tailwindEntry,
    config,
    resolved: resolveConfig(config),
    stockResolved: resolveConfig({}),
    tailwind,
    postcss,
    require: req,
  };
}

/** String globs from `content` (array or `{ files }`); objects with `raw` are ignored. */
export function contentGlobs(config: TailwindConfigObject): string[] {
  const content = config.content;
  const files = Array.isArray(content)
    ? content
    : content &&
        typeof content === 'object' &&
        Array.isArray((content as { files?: unknown }).files)
      ? ((content as { files: unknown[] }).files as unknown[])
      : [];
  return files.filter((f): f is string => typeof f === 'string');
}
