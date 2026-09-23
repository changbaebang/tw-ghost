import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { type ParseArgsConfig, parseArgs } from 'node:util';
import pc from 'picocolors';
import { analyze } from './analyze.js';
import { describeEnvironment, type EnvReport, formatEnv } from './env.js';
import { TwGhostConfigError } from './errors.js';
import { applyFixMap, draftFixMap, formatFix, parseFixMap } from './fix.js';
import { DEFAULT_MAX_ANNOTATIONS, formatGithub } from './format-github.js';
import { formatSarif, formatSarifMany } from './format-sarif.js';
import { formatInit, type InitOptions, init } from './init.js';
import { type AnalyzeManyOptions, analyzeMany, resolveConfigPaths } from './multi.js';
import { formatHuman, formatHumanMany } from './report.js';

const require = createRequire(import.meta.url);
const { version } = require('../package.json') as { version: string };

const HELP = `tw-ghost ${version}
Find Tailwind classes that silently generate no CSS in YOUR config.

Usage
  tw-ghost [globs...] [options]
  tw-ghost init [options]          scaffold the CI workflow (and a fix-map draft) into this project

Options
  -c, --config <path>       tailwind.config.{ts,js,cjs,mjs} (default: walk up from cwd);
                            repeatable, accepts globs ("apps/*/tailwind.config.ts")
      --all-configs         analyze every tailwind.config.{ts,js,cjs,mjs} under cwd
                            (skips node_modules, dist, .next, build, out, coverage)
      --tailwind <dir>      resolve "tailwindcss" from this directory instead of the config's
                            (hoisted / strict monorepos where the config's folder cannot reach it)
      --env                 print the resolved environment (config, tailwindcss, postcss, globs)
                            and exit — paste this into bug reports; honours --json
      --format <mode>       human | json | github | sarif (default: human)
                            github = one ::error workflow-command annotation per ghost occurrence
                            sarif  = a SARIF 2.1.0 log for GitHub Code Scanning (uncapped;
                                     --max-annotations does not apply)
      --json                alias for --format json
      --max-annotations <n> github: annotations printed before the rest are summarised in a
                            ::notice, 0 = all (default: 50)
      --unknown             also list utility-like classes that produce no CSS anywhere
                            (typos, dead tokens), and classes whose variant chain this
                            config does not know
      --unknown-all         with --unknown: list every raw unknown token instead of the
                            utility-like subset (words, identifiers, URLs — large)
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
      --dry-run             init: report what would be written without writing it
      --no-sarif            init: generate a --format github workflow instead of SARIF upload
      --no-fix-map          init: do not write a fix-map draft
      --workflow <name>     init: workflow file name (default: tw-ghost.yml)
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
  npx tw-ghost --format github          # in a GitHub Actions step
  npx tw-ghost --format sarif > tw-ghost.sarif   # upload to GitHub Code Scanning
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
  options: AnalyzeManyOptions & {
    format: 'human' | 'json' | 'github' | 'sarif';
    maxAnnotations: number;
    color: boolean;
    failOn: 'ghost' | 'none';
  },
): Promise<never> {
  const { format, maxAnnotations, color, failOn, ...analyzeOptions } = options;
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
  const code = multi.summary.failed > 0 ? 2 : failOn === 'ghost' && multi.summary.ghost > 0 ? 1 : 0;
  if (format === 'sarif') {
    // One run per config; configs that failed to load contribute no run (they are already on
    // stderr above and already force exit 2).
    const sarif = formatSarifMany(multi, { unknown: analyzeOptions.unknown });
    process.stderr.write(`${sarif.summary}\n`);
    return exitAfterWrite(process.stdout, `${JSON.stringify(sarif.log, null, 2)}\n`, code);
  }
  if (format === 'github') {
    // One annotation stream across configs under a single cap; the summary goes to stderr.
    const lines: string[] = [];
    let ghosts = 0;
    let occurrences = 0;
    for (const entry of multi.configs) {
      if (entry.error !== undefined) continue;
      const gh = formatGithub(entry, { maxAnnotations: 0 }); // uncapped per config
      if (gh.output) lines.push(...gh.output.split('\n'));
      ghosts += entry.ghosts.length;
      occurrences += entry.ghosts.reduce((n, g) => n + g.count, 0);
    }
    const kept = maxAnnotations > 0 ? lines.slice(0, maxAnnotations) : lines;
    const omitted = lines.length - kept.length;
    if (omitted > 0) kept.push(`::notice::tw-ghost: ${omitted} more annotations omitted`);
    process.stderr.write(
      `tw-ghost: ${ghosts} ghost classes, ${occurrences} occurrences across ${multi.summary.configs - multi.summary.failed} configs\n`,
    );
    return exitAfterWrite(process.stdout, kept.length > 0 ? `${kept.join('\n')}\n` : '', code);
  }
  const text =
    format === 'json'
      ? `${JSON.stringify({ version, ...multi }, null, 2)}\n`
      : `${formatHumanMany(multi, { color })}\n`;
  return exitAfterWrite(process.stdout, text, code);
}

async function main(): Promise<never> {
  const options = {
    config: { type: 'string', short: 'c', multiple: true },
    'all-configs': { type: 'boolean', default: false },
    tailwind: { type: 'string' },
    env: { type: 'boolean', default: false },
    format: { type: 'string' },
    json: { type: 'boolean', default: false },
    'max-annotations': { type: 'string', default: String(DEFAULT_MAX_ANNOTATIONS) },
    unknown: { type: 'boolean', default: false },
    'unknown-all': { type: 'boolean', default: false },
    'max-locations': { type: 'string', default: '3' },
    ignore: { type: 'string', multiple: true, default: [] as string[] },
    'allow-empty': { type: 'boolean', default: false },
    'fail-on': { type: 'string', default: 'ghost' },
    'no-suggestions': { type: 'boolean', default: false },
    'fix-map': { type: 'string' },
    'fix-map-init': { type: 'string' },
    write: { type: 'boolean', default: false },
    'no-color': { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
    'no-sarif': { type: 'boolean', default: false },
    'no-fix-map': { type: 'boolean', default: false },
    workflow: { type: 'string' },
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

  if (positionals[0] === 'init') {
    if (positionals.length > 1) {
      return fail(`init takes no positional arguments (got ${JSON.stringify(positionals[1])})`);
    }
    const initOptions: InitOptions = {
      dryRun: values['dry-run'],
      sarif: !values['no-sarif'],
      fixMap: !values['no-fix-map'],
    };
    const first = values.config?.[0];
    if (first !== undefined) initOptions.config = first;
    if (values.workflow !== undefined) initOptions.workflow = values.workflow;
    const result = await init(initOptions);
    const out = values.json
      ? `${JSON.stringify({ version, ...result }, null, 2)}\n`
      : formatInit(result, { color: !values['no-color'] });
    // Exit 0 even when ghosts were found: init reports, the workflow is what fails a build.
    return exitAfterWrite(process.stdout, out, 0);
  }
  const format = values.format ?? (values.json ? 'json' : 'human');
  if (format !== 'human' && format !== 'json' && format !== 'github' && format !== 'sarif') {
    return fail(
      `--format must be "human", "json", "github" or "sarif" (got ${JSON.stringify(format)})`,
    );
  }
  if (values.json && format !== 'json') {
    return fail(
      `--json is an alias for --format json; it cannot be combined with --format ${format}`,
    );
  }
  const maxAnnotationsRaw = values['max-annotations'] ?? String(DEFAULT_MAX_ANNOTATIONS);
  if (!/^\d+$/.test(maxAnnotationsRaw)) {
    return fail(
      `--max-annotations must be a non-negative integer (got ${JSON.stringify(maxAnnotationsRaw)})`,
    );
  }
  const maxAnnotations = Number.parseInt(maxAnnotationsRaw, 10);
  // --config is repeatable and may be a glob; --all-configs discovers every config under cwd.
  // An empty list means "auto-detect by walking up from cwd", exactly as before.
  const configPaths = await resolveConfigPaths({
    configs: values.config,
    all: values['all-configs'],
  });
  const singleConfig = configPaths.length <= 1 ? configPaths[0] : undefined;

  if (values.env) {
    if (configPaths.length > 1) return envMany(configPaths, values.tailwind, format === 'json');
    const env = describeEnvironment({ config: singleConfig, tailwind: values.tailwind });
    const text =
      format === 'json'
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
      maxLocations: format === 'github' || format === 'sarif' ? 0 : maxLocations,
      suggestions: !values['no-suggestions'],
      tailwind: values.tailwind,
      format,
      maxAnnotations,
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
    unknownAll: values['unknown-all'],
    // github and sarif report every occurrence, so they need the unclipped list (0 = all)
    maxLocations: format === 'github' || format === 'sarif' ? 0 : maxLocations,
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
    if (format === 'json') {
      const payload = { version, fix: { write: values.write, ...result } };
      return exitAfterWrite(process.stdout, `${JSON.stringify(payload, null, 2)}\n`, code);
    }
    return exitAfterWrite(
      process.stdout,
      formatFix(result, { write: values.write, color: !values['no-color'] }),
      code,
    );
  }

  let output: string;
  if (format === 'json') {
    output = `${JSON.stringify({ version, ...report }, null, 2)}\n`;
  } else if (format === 'github') {
    const gh = formatGithub(report, { maxAnnotations });
    process.stderr.write(`${gh.summary}\n`);
    output = gh.output === '' ? '' : `${gh.output}\n`;
  } else if (format === 'sarif') {
    // Uncapped by design: SARIF feeds a viewer that pages and groups on its own.
    const sarif = formatSarif(report, { unknown: values.unknown });
    process.stderr.write(`${sarif.summary}\n`);
    output = `${JSON.stringify(sarif.log, null, 2)}\n`;
  } else {
    output = `${formatHuman(report, { color: !values['no-color'], unknownAll: values['unknown-all'] })}\n`;
  }
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
