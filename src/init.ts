import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { analyze } from './analyze.js';
import { TwGhostConfigError } from './errors.js';
import { draftFixMap } from './fix.js';
import { toPosix } from './paths.js';
import { findConfig } from './project.js';
import { VERSION } from './version.js';

/**
 * `tw-ghost init` writes the files a project needs to keep tw-ghost running: a GitHub Actions
 * workflow and, when the first scan finds ghosts, a fix-map draft. It never overwrites and it
 * never installs anything; every file it would write is reported, so `--dry-run` is a plan.
 */
export type InitFileStatus = 'created' | 'exists' | 'skipped';

export interface InitFile {
  /** Path relative to the project root, POSIX separators. */
  path: string;
  status: InitFileStatus;
  /** Why a file was skipped (`exists` needs no reason). */
  reason?: string;
  /** Bytes that were (or would be) written. */
  contents?: string;
}

export interface InitResult {
  root: string;
  /** Config the scan used, relative to root; `null` when none was found. */
  config: string | null;
  /** Ghost classes found by the initial scan; `null` when the scan was skipped or failed. */
  ghosts: number | null;
  /** Set when the initial scan could not run; init still writes the workflow. */
  scanError?: string;
  files: InitFile[];
  /** True when nothing was written (`--dry-run`). */
  dryRun: boolean;
}

export interface InitOptions {
  /** Project root. Default: `process.cwd()`. */
  cwd?: string | undefined;
  /** Config path for the scan and for the generated workflow. Default: auto-detected. */
  config?: string | undefined;
  /** Report what would be written without writing it. Default: false. */
  dryRun?: boolean | undefined;
  /** Also write a fix-map draft when the scan finds ghosts. Default: true. */
  fixMap?: boolean | undefined;
  /** Upload SARIF to code scanning in the generated workflow. Default: true. */
  sarif?: boolean | undefined;
  /** Workflow file name under `.github/workflows`. Default: `tw-ghost.yml`. */
  workflow?: string | undefined;
}

interface PackageInfo {
  /** `npm` | `pnpm` | `yarn` | `bun`, from `packageManager` or a lockfile. */
  manager: 'npm' | 'pnpm' | 'yarn' | 'bun';
  /** Exact `packageManager` string when the project pins one. */
  packageManager?: string;
  /** True when tailwindcss is a dependency of the root package. */
  hasTailwind: boolean;
}

const LOCKFILES: [string, PackageInfo['manager']][] = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
  ['package-lock.json', 'npm'],
];

export function detectPackageInfo(root: string): PackageInfo {
  let manager: PackageInfo['manager'] = 'npm';
  let packageManager: string | undefined;
  let hasTailwind = false;
  const pkgPath = path.join(root, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
        packageManager?: string;
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      if (typeof pkg.packageManager === 'string') {
        packageManager = pkg.packageManager;
        const name = pkg.packageManager.split('@')[0];
        if (name === 'pnpm' || name === 'yarn' || name === 'npm' || name === 'bun') manager = name;
      }
      hasTailwind =
        pkg.dependencies?.tailwindcss !== undefined ||
        pkg.devDependencies?.tailwindcss !== undefined;
    } catch {
      // A malformed package.json is the project's problem; fall back to defaults.
    }
  }
  if (packageManager === undefined) {
    for (const [file, name] of LOCKFILES) {
      if (existsSync(path.join(root, file))) {
        manager = name;
        break;
      }
    }
  }
  const info: PackageInfo = { manager, hasTailwind };
  if (packageManager !== undefined) info.packageManager = packageManager;
  return info;
}

function installSteps(info: PackageInfo): string {
  const setup =
    info.manager === 'pnpm'
      ? `      - uses: pnpm/action-setup@v4\n`
      : info.manager === 'bun'
        ? `      - uses: oven-sh/setup-bun@v2\n`
        : '';
  const cache =
    info.manager === 'bun'
      ? ''
      : `\n        with:\n          node-version: 20\n          cache: ${info.manager}`;
  const node = info.manager === 'bun' ? '' : `      - uses: actions/setup-node@v4${cache}\n`;
  const install =
    info.manager === 'pnpm'
      ? '      - run: pnpm install --frozen-lockfile\n'
      : info.manager === 'yarn'
        ? '      - run: yarn install --immutable\n'
        : info.manager === 'bun'
          ? '      - run: bun install --frozen-lockfile\n'
          : '      - run: npm ci\n';
  return setup + node + install;
}

/**
 * Command that runs tw-ghost in CI. The generated workflow installs the project's dependencies but
 * does not add tw-ghost to them, so this has to work either way: `pnpm dlx` / `yarn dlx` / `bunx` /
 * `npx` all fetch the package when it is missing and use the installed one when it is present.
 */
function runner(info: PackageInfo): string {
  switch (info.manager) {
    case 'pnpm':
      return 'pnpm dlx';
    case 'yarn':
      return 'yarn dlx';
    case 'bun':
      return 'bunx';
    default:
      return 'npx';
  }
}

export interface WorkflowOptions {
  info: PackageInfo;
  /** `--config` argument for the generated commands; omitted when auto-detection is enough. */
  config?: string | undefined;
  sarif: boolean;
}

export function renderWorkflow(options: WorkflowOptions): string {
  const { info, sarif } = options;
  const run = runner(info);
  const configArg = options.config ? ` --config ${options.config}` : '';
  const permissions = sarif
    ? 'permissions:\n  contents: read\n  security-events: write # upload-sarif\n'
    : 'permissions:\n  contents: read\n';
  const analyzeStep = sarif
    ? `      # SARIF goes to a file; ghosts still make this step exit 1.\n      - run: ${run} tw-ghost --format sarif${configArg} > tw-ghost.sarif\n      - if: always() # upload the findings even when the step above failed\n        uses: github/codeql-action/upload-sarif@v3\n        with:\n          sarif_file: tw-ghost.sarif\n          category: tw-ghost\n`
    : `      - run: ${run} tw-ghost --format github${configArg}\n`;
  return `# Written by tw-ghost ${VERSION} (\`tw-ghost init\`).
# Fails the check when a Tailwind class in this project produces no CSS.
# Docs: https://github.com/changbaebang/tw-ghost#readme
name: tw-ghost

on:
  push:
    branches: [main]
  pull_request:

${permissions}
jobs:
  tw-ghost:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
${installSteps(info)}${analyzeStep}`;
}

/** Write `contents` unless the file exists; returns the resulting `InitFile`. */
async function writeIfAbsent(
  root: string,
  relative: string,
  contents: string,
  dryRun: boolean,
): Promise<InitFile> {
  const absolute = path.join(root, relative);
  if (existsSync(absolute)) return { path: toPosix(relative), status: 'exists' };
  if (!dryRun) {
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, contents, 'utf8');
  }
  return { path: toPosix(relative), status: 'created', contents };
}

/**
 * Scaffold tw-ghost into a project: a workflow, and a fix-map draft when there is something to
 * fix. Existing files are left alone. Nothing is installed and nothing is committed.
 */
export async function init(options: InitOptions = {}): Promise<InitResult> {
  const root = path.resolve(options.cwd ?? process.cwd());
  const dryRun = options.dryRun === true;
  const sarif = options.sarif !== false;
  const info = detectPackageInfo(root);

  const configAbs = options.config ? path.resolve(root, options.config) : findConfig(root);
  const configRel = configAbs ? toPosix(path.relative(root, configAbs)) : null;
  if (options.config && configAbs && !existsSync(configAbs)) {
    throw new TwGhostConfigError(`--config: ${configAbs} does not exist`);
  }

  const files: InitFile[] = [];
  const workflowName = options.workflow ?? 'tw-ghost.yml';
  const workflowOptions: WorkflowOptions = { info, sarif };
  // Only pass --config in the workflow when auto-detection would not find the same file: a config
  // at the root is found by walking up from the working directory.
  if (configRel && configRel.includes('/')) workflowOptions.config = configRel;
  files.push(
    await writeIfAbsent(
      root,
      path.join('.github', 'workflows', workflowName),
      renderWorkflow(workflowOptions),
      dryRun,
    ),
  );

  let ghosts: number | null = null;
  let scanError: string | undefined;
  if (configAbs) {
    try {
      const report = await analyze({
        cwd: root,
        config: configAbs,
        allowEmpty: true,
        maxLocations: 0,
      });
      ghosts = report.ghosts.length;
      if (options.fixMap !== false && report.ghosts.length > 0) {
        files.push(
          await writeIfAbsent(
            root,
            'tw-ghost.fixes.json',
            `${JSON.stringify(draftFixMap(report.ghosts, report.separator), null, 2)}\n`,
            dryRun,
          ),
        );
      } else if (options.fixMap !== false) {
        files.push({
          path: 'tw-ghost.fixes.json',
          status: 'skipped',
          reason: 'no ghost classes to fix',
        });
      }
    } catch (error) {
      scanError = error instanceof Error ? error.message : String(error);
      if (options.fixMap !== false) {
        files.push({
          path: 'tw-ghost.fixes.json',
          status: 'skipped',
          reason: 'the initial scan failed',
        });
      }
    }
  } else if (options.fixMap !== false) {
    files.push({ path: 'tw-ghost.fixes.json', status: 'skipped', reason: 'no Tailwind config' });
  }

  const result: InitResult = { root, config: configRel, ghosts, files, dryRun };
  if (scanError !== undefined) result.scanError = scanError;
  return result;
}

export interface FormatInitOptions {
  color: boolean;
}

/** Human-readable summary of an init run, plus the next command to type. */
export function formatInit(result: InitResult, options: FormatInitOptions): string {
  const plain = (t: string): string => t;
  const c = options.color
    ? {
        bold: (t: string) => `[1m${t}[22m`,
        green: (t: string) => `[32m${t}[39m`,
        yellow: (t: string) => `[33m${t}[39m`,
        dim: (t: string) => `[2m${t}[22m`,
      }
    : { bold: plain, green: plain, yellow: plain, dim: plain };

  const lines: string[] = [];
  lines.push(
    result.dryRun
      ? `${c.yellow('tw-ghost init (dry run)')} ${c.dim('— nothing written')}`
      : c.green('tw-ghost init'),
  );
  lines.push('');
  for (const file of result.files) {
    const mark =
      file.status === 'created'
        ? c.green(result.dryRun ? 'would create' : 'created    ')
        : file.status === 'exists'
          ? c.dim('exists     ')
          : c.dim('skipped    ');
    lines.push(`  ${mark} ${file.path}${file.reason ? c.dim(` (${file.reason})`) : ''}`);
  }
  lines.push('');
  if (result.config === null) {
    lines.push(
      `  ${c.yellow('no tailwind.config.{ts,js,cjs,mjs}')} under ${result.root} — the workflow is written, but pass`,
    );
    lines.push('  --config to it (and to tw-ghost) once the config exists.');
  } else {
    lines.push(`  config  ${result.config}`);
    if (result.scanError !== undefined) {
      lines.push(`  ${c.yellow('scan failed')}  ${result.scanError}`);
    } else if (result.ghosts !== null) {
      lines.push(
        `  ghosts  ${result.ghosts === 0 ? c.green('0') : c.yellow(String(result.ghosts))} class${result.ghosts === 1 ? '' : 'es'}`,
      );
    }
  }
  lines.push('');
  lines.push(c.bold('  Next'));
  if (result.ghosts !== null && result.ghosts > 0) {
    const created = result.files.some(
      (f) => f.path === 'tw-ghost.fixes.json' && f.status === 'created',
    );
    lines.push(`    1. review ${created ? 'tw-ghost.fixes.json' : 'the ghost list'}: npx tw-ghost`);
    if (created) {
      lines.push('    2. reduce each candidate list to one class (or null to remove it)');
      lines.push('    3. npx tw-ghost --fix-map tw-ghost.fixes.json          # dry run');
      lines.push('    4. npx tw-ghost --fix-map tw-ghost.fixes.json --write  # apply');
    }
  } else {
    lines.push('    npx tw-ghost        # nothing to fix; the workflow keeps it that way');
  }
  return `${lines.join('\n')}\n`;
}
