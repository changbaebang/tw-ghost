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

/** Oldest Tailwind release that ships `tailwindcss/loadConfig` (ESM/TypeScript config loader). */
export const MIN_TAILWIND_VERSION = '3.3.0';
/** Human-readable range printed in preflight errors. */
export const SUPPORTED_TAILWIND_RANGE = '3.3.x – 3.4.x';
export const COMPATIBILITY_DOCS =
  'https://github.com/changbaebang/tw-ghost#requirements--compatibility';

/**
 * Throws `TwGhostConfigError` unless `version` is a Tailwind release this tool can drive:
 * major 3, minor >= 3 (`tailwindcss/loadConfig` and `tailwindcss/resolveConfig` are what the
 * generation model needs; `loadConfig` appeared in 3.3.0).
 */
export function assertSupportedTailwind(version: string): void {
  const [majorRaw, minorRaw] = version.split('.');
  const major = Number.parseInt(majorRaw ?? '', 10);
  const minor = Number.parseInt(minorRaw ?? '', 10);
  if (Number.isNaN(major)) {
    throw new TwGhostConfigError(
      `Unsupported Tailwind CSS version ${JSON.stringify(version)} (tw-ghost supports ${SUPPORTED_TAILWIND_RANGE}). ${COMPATIBILITY_DOCS}`,
    );
  }
  if (major >= 4) {
    throw new TwGhostConfigError(
      [
        `Unsupported Tailwind CSS version: found ${version}, tw-ghost supports ${SUPPORTED_TAILWIND_RANGE} only.`,
        'Tailwind v4 is CSS-first (no tailwind.config.js) and the v3 "generate with your config, compare with stock" model this tool relies on does not apply; tw-ghost is v3-only.',
        `See ${COMPATIBILITY_DOCS}`,
      ].join(' '),
    );
  }
  if (major < 3) {
    throw new TwGhostConfigError(
      [
        `Unsupported Tailwind CSS version: found ${version}, tw-ghost supports ${SUPPORTED_TAILWIND_RANGE} only.`,
        `Tailwind v${major} predates the loadConfig/resolveConfig entry points this tool needs; upgrade to tailwindcss ${MIN_TAILWIND_VERSION} or newer.`,
        `See ${COMPATIBILITY_DOCS}`,
      ].join(' '),
    );
  }
  if (Number.isNaN(minor) || minor < 3) {
    throw new TwGhostConfigError(
      [
        `Unsupported Tailwind CSS version: found ${version}, need >=${MIN_TAILWIND_VERSION}.`,
        `"tailwindcss/loadConfig" (the ESM/TypeScript config loader tw-ghost uses) was added in ${MIN_TAILWIND_VERSION}; upgrade tailwindcss.`,
        `See ${COMPATIBILITY_DOCS}`,
      ].join(' '),
    );
  }
}

/** @deprecated Use `assertSupportedTailwind`; kept for API compatibility. */
export const assertTailwindV3 = assertSupportedTailwind;

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
  /** Directory of the resolved `tailwindcss` package (its package.json lives here). */
  tailwindPackageDir: string;
  /** The config exactly as exported by the file (after jiti/TS transform). */
  config: TailwindConfigObject;
  /** `resolveConfig(config)` using the project's Tailwind. */
  resolved: ResolvedTailwindConfig;
  /** `resolveConfig({})` — the stock resolved config for the same Tailwind version. */
  stockResolved: ResolvedTailwindConfig;
  tailwind: TailwindPlugin;
  postcss: PostcssModule;
  /** Resolved path of the `postcss` module that will run the generation. */
  postcssPath: string;
  postcssPackageDir: string;
  postcssVersion: string;
  /** `require` that resolves `tailwindcss` (bound to the config file, or to `--tailwind <dir>`). */
  require: NodeRequire;
  /** Degraded-run notices (config features tw-ghost does not apply). Printed once by the CLI. */
  warnings: string[];
}

export interface LoadProjectOptions {
  /**
   * Directory to resolve `tailwindcss` from instead of the config file's directory
   * (`--tailwind <dir>`): use it when the config lives in a folder without a `node_modules`
   * that reaches a Tailwind install (hoisted or strict monorepos). The config file itself is
   * still loaded by Tailwind's `loadConfig`, so its own `require()`s resolve from its location.
   */
  tailwindDir?: string | undefined;
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
 * Tailwind 3.3.0's `loadConfig` returns the module record as-is; an ESM config then arrives as
 * `{ default: config }` (Node >= 22.12 `require(esm)`, or jiti for `.mjs`). 3.4.x unwraps it.
 * Do the same so both versions see the same object.
 */
export function unwrapDefaultExport(mod: unknown): unknown {
  if (mod === null || typeof mod !== 'object') return mod;
  const record = mod as Record<string, unknown>;
  const inner = record.default;
  if (
    inner !== null &&
    typeof inner === 'object' &&
    !('content' in record) &&
    !('theme' in record)
  ) {
    return inner;
  }
  return mod;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

/** Warnings for `content` features Tailwind would apply at build time but tw-ghost does not. */
export function contentWarnings(config: TailwindConfigObject): string[] {
  const warnings: string[] = [];
  const content = config.content;
  if (!isRecord(content)) return warnings;
  const notApplied: string[] = [];
  if (content.transform !== undefined) notApplied.push('content.transform');
  if (content.extract !== undefined) notApplied.push('content.extract');
  if (notApplied.length > 0) {
    warnings.push(
      `${notApplied.join('/')} ${notApplied.length > 1 ? 'are' : 'is'} not applied; tw-ghost scans raw file text with Tailwind's default extractor, so classes produced only by a transform are not seen (and classes a transform would remove are still judged).`,
    );
  }
  return warnings;
}

/**
 * Load a Tailwind v3 config using the *project's* own tailwindcss/postcss installation,
 * resolved relative to the config file.
 */
export function loadProject(
  configPathInput: string,
  options: LoadProjectOptions = {},
): LoadedProject {
  const configPath = path.resolve(configPathInput);
  if (!existsSync(configPath)) {
    throw new TwGhostConfigError(`Config file not found: ${configPath}`);
  }
  const configDir = path.dirname(configPath);
  const tailwindDir = options.tailwindDir ? path.resolve(options.tailwindDir) : undefined;
  if (tailwindDir !== undefined && !existsSync(tailwindDir)) {
    throw new TwGhostConfigError(`--tailwind directory not found: ${tailwindDir}`);
  }
  // A `require` anchored in the directory tailwindcss is resolved from. The file name is a
  // placeholder: createRequire only uses its directory for module resolution.
  const req = tailwindDir
    ? createRequire(path.join(tailwindDir, '__tw-ghost__.cjs'))
    : createRequire(configPath);
  const resolveBase = tailwindDir ?? configDir;

  const pkgJsonPath = resolveFrom(req, 'tailwindcss/package.json');
  if (!pkgJsonPath) {
    throw new TwGhostConfigError(
      [
        `Could not resolve "tailwindcss" from ${resolveBase}.`,
        "Resolution starts at the config file's directory and walks up through node_modules, so tailwindcss must be installed in the project that owns the config file (a hoisted install in a parent directory works too).",
        tailwindDir
          ? 'Check the --tailwind directory: it must contain (or sit below) a node_modules with tailwindcss.'
          : 'If Tailwind is installed elsewhere (strict monorepo, config in a folder without node_modules), pass --tailwind <dir> pointing at a directory from which "tailwindcss" resolves.',
      ].join(' '),
    );
  }
  const tailwindVersion = String((req(pkgJsonPath) as { version: string }).version);
  assertSupportedTailwind(tailwindVersion);

  const tailwindEntry = req.resolve('tailwindcss');
  const tailwind = req('tailwindcss') as TailwindPlugin;
  const loadConfigPath = resolveFrom(req, 'tailwindcss/loadConfig');
  const resolveConfigPath = resolveFrom(req, 'tailwindcss/resolveConfig');
  if (!loadConfigPath || !resolveConfigPath) {
    throw new TwGhostConfigError(
      `tailwindcss ${tailwindVersion} at ${path.dirname(pkgJsonPath)} does not provide "tailwindcss/loadConfig" and "tailwindcss/resolveConfig"; tw-ghost needs tailwindcss >=${MIN_TAILWIND_VERSION} (${SUPPORTED_TAILWIND_RANGE}). Is the install complete? See ${COMPATIBILITY_DOCS}`,
    );
  }
  const loadConfigMod = req(loadConfigPath) as
    | ((p: string) => unknown)
    | { default: (p: string) => unknown };
  const loadConfig = typeof loadConfigMod === 'function' ? loadConfigMod : loadConfigMod.default;
  const resolveConfigMod = req(resolveConfigPath) as
    | ((c: TailwindConfigObject) => ResolvedTailwindConfig)
    | { default: (c: TailwindConfigObject) => ResolvedTailwindConfig };
  const resolveConfig =
    typeof resolveConfigMod === 'function' ? resolveConfigMod : resolveConfigMod.default;

  // Prefer the project's postcss; fall back to the one tailwindcss itself depends on.
  const postcssPath =
    resolveFrom(req, 'postcss') ?? createRequire(tailwindEntry).resolve('postcss');
  const postcss = req(postcssPath) as PostcssModule;
  const postcssPkgJsonPath = createRequire(postcssPath).resolve('postcss/package.json');
  const postcssVersion = String(
    (req(postcssPkgJsonPath) as { version?: unknown }).version ?? 'unknown',
  );

  let loaded: unknown;
  try {
    loaded = unwrapDefaultExport(loadConfig(configPath));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new TwGhostConfigError(`Failed to load ${configPath}: ${message}`);
  }
  if (typeof loaded === 'function') {
    throw new TwGhostConfigError(
      `${configPath} exports a function. Tailwind v3 expects a plain config object (\`module.exports = { … }\` / \`export default { … }\`); tw-ghost does not call it.`,
    );
  }
  if (!isRecord(loaded)) {
    throw new TwGhostConfigError(
      `${configPath} did not export a config object (got ${loaded === null ? 'null' : typeof loaded}).`,
    );
  }
  const config = loaded as TailwindConfigObject;

  let resolved: ResolvedTailwindConfig;
  try {
    resolved = resolveConfig(config);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new TwGhostConfigError(
      `Failed to resolve ${configPath} with tailwindcss/resolveConfig: ${message}`,
    );
  }

  return {
    configPath,
    configDir,
    tailwindVersion,
    tailwindEntry,
    tailwindPackageDir: path.dirname(pkgJsonPath),
    config,
    resolved,
    stockResolved: resolveConfig({}),
    tailwind,
    postcss,
    postcssPath,
    postcssPackageDir: path.dirname(postcssPkgJsonPath),
    postcssVersion,
    require: req,
    warnings: contentWarnings(config),
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
