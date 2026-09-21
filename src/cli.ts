import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { type ParseArgsConfig, parseArgs } from 'node:util';
import pc from 'picocolors';
import { analyze } from './analyze.js';
import { describeEnvironment, formatEnv } from './env.js';
import { TwGhostConfigError } from './errors.js';
import { applyFixMap, draftFixMap, formatFix, parseFixMap } from './fix.js';
import { formatHuman } from './report.js';

const require = createRequire(import.meta.url);
const { version } = require('../package.json') as { version: string };

const HELP = `tw-ghost ${version}
Find Tailwind classes that silently generate no CSS in YOUR config.

Usage
  tw-ghost [globs...] [options]

Options
  -c, --config <path>       tailwind.config.{ts,js,cjs,mjs} (default: walk up from cwd)
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
      --fix-map-init <file> write a fix-map draft for the current ghosts (one key per bare
                            utility; a single suggestion, a candidate list, or null) and exit 0
      --fix-map <file>      apply a fix map: replace / remove each ghost occurrence, carrying
                            variants, "!" and "-" over. Dry run unless --write. Exit 1 when
                            ghosts remain unmapped (unless --fail-on none)
      --write               with --fix-map: write the changed files
      --no-color            disable colors
  -h, --help                show this help
  -v, --version             print version

Exit codes
  0  no findings         1  ghosts found (unless --fail-on none)
  2  usage / config error (bad flag, no config, no files matched, unsupported Tailwind version)

Examples
  npx tw-ghost
  npx tw-ghost "src/**/*.tsx" --config apps/web/tailwind.config.ts
  npx tw-ghost --json --unknown --ignore "^legacy-"
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

async function main(): Promise<never> {
  const options = {
    config: { type: 'string', short: 'c' },
    tailwind: { type: 'string' },
    env: { type: 'boolean', default: false },
    json: { type: 'boolean', default: false },
    unknown: { type: 'boolean', default: false },
    'max-locations': { type: 'string', default: '3' },
    ignore: { type: 'string', multiple: true, default: [] as string[] },
    'allow-empty': { type: 'boolean', default: false },
    'fail-on': { type: 'string', default: 'ghost' },
    'no-suggestions': { type: 'boolean', default: false },
    'fix-map': { type: 'string' },
    'fix-map-init': { type: 'string' },
    write: { type: 'boolean', default: false },
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
  if (values.env) {
    const env = describeEnvironment({ config: values.config, tailwind: values.tailwind });
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

  const report = await analyze({
    config: values.config,
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

  if (values['fix-map-init'] !== undefined) {
    const target = path.resolve(values['fix-map-init']);
    if (existsSync(target)) {
      return fail(`--fix-map-init: ${target} already exists; delete it or choose another path`);
    }
    const draft = draftFixMap(report.ghosts, report.separator);
    await writeFile(target, `${JSON.stringify(draft, null, 2)}\n`, 'utf8');
    const entries = Object.values(draft);
    const multi = entries.filter((v) => Array.isArray(v)).length;
    const none = entries.filter((v) => v === null).length;
    process.stderr.write(
      `${pc.cyan('tw-ghost:')} wrote ${target}: ${entries.length} ghost classes (${multi} with several candidates to pick from, ${none} with none: null removes the class, or set a replacement).\n`,
    );
    return exitAfterWrite(process.stdout, '', 0);
  }

  if (values['fix-map'] !== undefined) {
    const mapPath = path.resolve(values['fix-map']);
    let mapText: string;
    try {
      mapText = await readFile(mapPath, 'utf8');
    } catch {
      return fail(`--fix-map: cannot read ${mapPath}`);
    }
    const map = parseFixMap(mapText, mapPath);
    const occurrences = new Map<string, ReadonlySet<string>>();
    for (const ghost of report.ghosts) occurrences.set(ghost.class, new Set(ghost.files));
    const result = await applyFixMap({
      occurrences,
      map,
      separator: report.separator,
      write: values.write,
    });
    const code = result.unmapped.length > 0 && failOn === 'ghost' ? 1 : 0;
    if (values.json) {
      const payload = { version, fix: { write: values.write, ...result } };
      return exitAfterWrite(process.stdout, `${JSON.stringify(payload, null, 2)}\n`, code);
    }
    return exitAfterWrite(
      process.stdout,
      formatFix(result, { write: values.write, color: !values['no-color'] }),
      code,
    );
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
