import { createRequire } from 'node:module';
import path from 'node:path';
import { type ParseArgsConfig, parseArgs } from 'node:util';
import pc from 'picocolors';
import { analyze } from './analyze.js';
import { describeEnvironment, type EnvReport, formatEnv } from './env.js';
import { TwGhostConfigError } from './errors.js';
import { type AnalyzeManyOptions, analyzeMany, resolveConfigPaths } from './multi.js';
import { formatHuman, formatHumanMany } from './report.js';

const require = createRequire(import.meta.url);
const { version } = require('../package.json') as { version: string };

const HELP = `tw-ghost ${version}
Find Tailwind classes that silently generate no CSS in YOUR config.

Usage
  tw-ghost [globs...] [options]

Options
  -c, --config <path>       tailwind.config.{ts,js,cjs,mjs} (default: walk up from cwd);
                            repeatable, accepts globs ("apps/*/tailwind.config.ts")
      --all-configs         analyze every tailwind.config.{ts,js,cjs,mjs} under cwd
                            (skips node_modules, dist, .next, build, out, coverage)
      --tailwind <dir>      resolve "tailwindcss" from this directory instead of the config's
                            (hoisted / strict monorepos where the config's folder cannot reach it)
      --env                 print the resolved environment (config, tailwindcss, postcss, globs)
                            and exit — paste this into bug reports; honours --json
      --json                machine-readable JSON on stdout
      --unknown             also list utility-looking classes that produce no CSS anywhere,
                            and classes whose variant chain this config does not know
      --max-locations <n>   locations printed per class, 0 = all (default: 3)
      --ignore <regex>      skip classes matching this regex (repeatable)
      --allow-empty         exit 0 instead of 2 when no files match / nothing to scan
      --fail-on <mode>      ghost | none — what makes the exit code 1 (default: ghost)
      --no-suggestions      skip the "try:" replacement search (faster)
      --no-color            disable colors
  -h, --help                show this help
  -v, --version             print version

Exit codes
  0  no findings         1  ghosts found (unless --fail-on none)
  2  usage / config error (bad flag, no config, no files matched, unsupported Tailwind version);
     with several configs, any config that failed (the others are still reported)

Examples
  npx tw-ghost
  npx tw-ghost "src/**/*.tsx" --config apps/web/tailwind.config.ts
  npx tw-ghost --json --unknown --ignore "^legacy-"
  npx tw-ghost --all-configs --json     # monorepo: every config, one JSON document
`;

/**
 * Write, then exit once the stream has flushed. On macOS a pipe is asynchronous, so a bare
 * `process.exit()` after a large `stdout.write()` would truncate `--json` output.
 */
function exitAfterWrite(stream: NodeJS.WriteStream, text: string, code: number): never {
  stream.write(text, () => process.exit(code));
  // Keep the promise chain from continuing while the flush is pending.
  return new Promise(() => {}) as never;
}

function fail(message: string): never {
  return exitAfterWrite(process.stderr, `${pc.red('tw-ghost:')} ${message}\n`, 2);
}

const relativeToCwd = (p: string): string =>
  path.relative(process.cwd(), p).split(path.sep).join('/');

/** `--env` with several configs: one block (or JSON entry) per config; exit 2 if any fails. */
function envMany(configPaths: string[], tailwind: string | undefined, json: boolean): never {
  const entries: Array<{ config: string; env?: EnvReport; error?: string }> = [];
  for (const configPath of configPaths) {
    const config = relativeToCwd(configPath);
    try {
      entries.push({ config, env: describeEnvironment({ config: configPath, tailwind }) });
    } catch (error) {
      if (!(error instanceof TwGhostConfigError)) throw error;
      entries.push({ config, error: error.message });
    }
  }
  const failed = entries.filter((e) => e.error !== undefined).length;
  const text = json
    ? `${JSON.stringify(
        {
          version,
          configs: entries.map((e) =>
            e.env ? { config: e.config, ...e.env } : { config: e.config, error: e.error },
          ),
        },
        null,
        2,
      )}\n`
    : `${entries
        .map((e) =>
          e.env
            ? `== ${e.config}\n${formatEnv(e.env, version)}`
            : `== ${e.config} (failed to load)\n${e.error}`,
        )
        .join('\n\n')}\n`;
  return exitAfterWrite(process.stdout, text, failed > 0 ? 2 : 0);
}

/** Several configs: analyze each independently, print per-config blocks or one JSON document. */
async function runMany(
  configPaths: string[],
  options: AnalyzeManyOptions & { json: boolean; color: boolean; failOn: 'ghost' | 'none' },
): Promise<never> {
  const { json, color, failOn, ...analyzeOptions } = options;
  const multi = await analyzeMany(configPaths, analyzeOptions);
  for (const entry of multi.configs) {
    if (entry.error !== undefined) continue;
    for (const warning of entry.warnings) {
      process.stderr.write(`${pc.yellow('tw-ghost: warning:')} [${entry.config}] ${warning}\n`);
    }
  }
  if (multi.summary.failed > 0) {
    const failed = multi.configs.filter((e) => e.error !== undefined);
    process.stderr.write(
      `${pc.red('tw-ghost:')} ${failed.length} of ${multi.summary.configs} configs failed: ${failed.map((e) => e.config).join(', ')}\n`,
    );
  }
  const text = json
    ? `${JSON.stringify({ version, ...multi }, null, 2)}\n`
    : `${formatHumanMany(multi, { color })}\n`;
  const code = multi.summary.failed > 0 ? 2 : failOn === 'ghost' && multi.summary.ghost > 0 ? 1 : 0;
  return exitAfterWrite(process.stdout, text, code);
}

async function main(): Promise<never> {
  const options = {
    config: { type: 'string', short: 'c', multiple: true },
    'all-configs': { type: 'boolean', default: false },
    tailwind: { type: 'string' },
    env: { type: 'boolean', default: false },
    json: { type: 'boolean', default: false },
    unknown: { type: 'boolean', default: false },
    'max-locations': { type: 'string', default: '3' },
    ignore: { type: 'string', multiple: true, default: [] as string[] },
    'allow-empty': { type: 'boolean', default: false },
    'fail-on': { type: 'string', default: 'ghost' },
    'no-suggestions': { type: 'boolean', default: false },
    'no-color': { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
    version: { type: 'boolean', short: 'v', default: false },
  } satisfies ParseArgsConfig['options'];
  let parsed: ReturnType<typeof parseArgs<{ options: typeof options; allowPositionals: true }>>;
  try {
    parsed = parseArgs({ args: process.argv.slice(2), options, allowPositionals: true });
  } catch (error) {
    return fail(`${(error as Error).message}\n\n${HELP}`);
  }
  const { values, positionals } = parsed;

  if (values.help) return exitAfterWrite(process.stdout, HELP, 0);
  if (values.version) return exitAfterWrite(process.stdout, `${version}\n`, 0);
  // --config is repeatable and may be a glob; --all-configs discovers every config under cwd.
  // An empty list means "auto-detect by walking up from cwd", exactly as before.
  const configPaths = await resolveConfigPaths({
    configs: values.config,
    all: values['all-configs'],
  });
  const singleConfig = configPaths.length <= 1 ? configPaths[0] : undefined;

  if (values.env) {
    if (configPaths.length > 1) return envMany(configPaths, values.tailwind, values.json);
    const env = describeEnvironment({ config: singleConfig, tailwind: values.tailwind });
    const text = values.json
      ? `${JSON.stringify({ version, ...env }, null, 2)}\n`
      : `${formatEnv(env, version)}\n`;
    return exitAfterWrite(process.stdout, text, 0);
  }
  const maxLocationsRaw = values['max-locations'] ?? '3';
  if (!/^\d+$/.test(maxLocationsRaw)) {
    return fail(
      `--max-locations must be a non-negative integer (got ${JSON.stringify(maxLocationsRaw)})`,
    );
  }
  const maxLocations = Number.parseInt(maxLocationsRaw, 10);
  const failOn = values['fail-on'] ?? 'ghost';
  if (failOn !== 'ghost' && failOn !== 'none') {
    return fail(`--fail-on must be "ghost" or "none" (got ${JSON.stringify(failOn)})`);
  }

  if (configPaths.length > 1) {
    return runMany(configPaths, {
      globs: positionals,
      allowEmpty: values['allow-empty'],
      ignore: values.ignore,
      unknown: values.unknown,
      maxLocations,
      suggestions: !values['no-suggestions'],
      tailwind: values.tailwind,
      json: values.json,
      color: !values['no-color'],
      failOn,
    });
  }

  const report = await analyze({
    config: singleConfig,
    globs: positionals,
    allowEmpty: values['allow-empty'],
    ignore: values.ignore,
    unknown: values.unknown,
    maxLocations,
    suggestions: !values['no-suggestions'],
    tailwind: values.tailwind,
  });
  for (const warning of report.warnings) {
    process.stderr.write(`${pc.yellow('tw-ghost: warning:')} ${warning}\n`);
  }

  const output = values.json
    ? `${JSON.stringify({ version, ...report }, null, 2)}\n`
    : `${formatHuman(report, { color: !values['no-color'] })}\n`;
  return exitAfterWrite(
    process.stdout,
    output,
    failOn === 'ghost' && report.ghosts.length > 0 ? 1 : 0,
  );
}

main().catch((error: unknown) => {
  if (error instanceof TwGhostConfigError) return fail(error.message);
  const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
  return fail(`unexpected error\n${detail}`);
});
