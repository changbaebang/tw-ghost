import path from 'node:path';
import { TwGhostConfigError } from './errors.js';
import { createExtractor } from './extract.js';
import { contentGlobs, findConfig, type LoadedProject, loadProject } from './project.js';

export interface EnvOptions {
  config?: string | undefined;
  cwd?: string | undefined;
  tailwind?: string | undefined;
}

/** What `tw-ghost --env` prints: everything a bug report needs to reproduce a run. */
export interface EnvReport {
  node: string;
  platform: string;
  cwd: string;
  configPath: string;
  configDir: string;
  tailwind: { version: string; path: string };
  postcss: { version: string; path: string };
  extractor: 'project' | 'bundled';
  content: {
    /** String globs tw-ghost will scan (resolved from `configDir`). */
    globs: string[];
    /** `content` entries that are not string globs (`{ raw }` objects) — never scanned. */
    nonGlobEntries: number;
    relative: boolean;
    transform: boolean;
    extract: boolean;
  };
  prefix: string;
  separator: string;
  important: boolean | string;
  darkMode: unknown;
  warnings: string[];
}

const asRecord = (v: unknown): Record<string, unknown> | undefined =>
  v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;

export function describeProject(project: LoadedProject, cwd: string): EnvReport {
  const { source: extractor } = createExtractor(project);
  const content = project.config.content;
  const contentRecord = asRecord(content);
  const entries = Array.isArray(content)
    ? content
    : Array.isArray(contentRecord?.files)
      ? (contentRecord.files as unknown[])
      : [];
  const globs = contentGlobs(project.config);
  return {
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    cwd,
    configPath: project.configPath,
    configDir: project.configDir,
    tailwind: { version: project.tailwindVersion, path: project.tailwindPackageDir },
    postcss: { version: project.postcssVersion, path: project.postcssPackageDir },
    extractor,
    content: {
      globs,
      nonGlobEntries: entries.length - globs.length,
      relative: contentRecord?.relative === true,
      transform: contentRecord?.transform !== undefined,
      extract: contentRecord?.extract !== undefined,
    },
    prefix: project.resolved.prefix ?? '',
    separator: project.resolved.separator ?? ':',
    important: project.resolved.important ?? false,
    darkMode: project.resolved.darkMode ?? 'media',
    warnings: project.warnings,
  };
}

/** Load the project the same way `analyze` does and describe it; throws `TwGhostConfigError`. */
export function describeEnvironment(options: EnvOptions = {}): EnvReport {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const configPath = options.config ? path.resolve(cwd, options.config) : findConfig(cwd);
  if (!configPath) {
    throw new TwGhostConfigError(
      `No tailwind.config.{ts,js,cjs,mjs} found walking up from ${cwd}. Pass --config <path>.`,
    );
  }
  const project = loadProject(configPath, { tailwindDir: options.tailwind });
  return describeProject(project, cwd);
}

export function formatEnv(env: EnvReport, version: string): string {
  const lines = [
    `tw-ghost     ${version}`,
    `node         ${env.node} (${env.platform})`,
    `cwd          ${env.cwd}`,
    `config       ${env.configPath}`,
    `tailwindcss  ${env.tailwind.version}  ${env.tailwind.path}`,
    `postcss      ${env.postcss.version}  ${env.postcss.path}`,
    `extractor    ${env.extractor}`,
    `content      ${env.content.globs.length} glob${env.content.globs.length === 1 ? '' : 's'} (resolved from ${env.configDir})${
      env.content.nonGlobEntries > 0
        ? `, ${env.content.nonGlobEntries} raw/object entries ignored`
        : ''
    }`,
    ...env.content.globs.map((g) => `               ${g}`),
    `content opts relative=${env.content.relative} transform=${env.content.transform} extract=${env.content.extract}`,
    `prefix       ${JSON.stringify(env.prefix)}`,
    `separator    ${JSON.stringify(env.separator)}`,
    `important    ${JSON.stringify(env.important)}`,
    `darkMode     ${JSON.stringify(env.darkMode)}`,
  ];
  for (const w of env.warnings) lines.push(`warning      ${w}`);
  return lines.join('\n');
}
