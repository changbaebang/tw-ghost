import { execFileSync } from 'node:child_process';
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
  /** Branch for the generated `push:` filter. Default: the repository's default branch. */
  branch?: string | undefined;
}

interface PackageInfo {
  /** `npm` | `pnpm` | `yarn` | `bun`, from `packageManager` or a lockfile. */
  manager: 'npm' | 'pnpm' | 'yarn' | 'bun';
  /** Exact `packageManager` string when the project pins one. */
  packageManager?: string;
  /**
   * Major version from `packageManager`, when pinned. The name alone is not enough: Yarn 1 has no
   * `--immutable` and no `dlx`, and Yarn 2+ removed `--frozen-lockfile`.
   */
  managerMajor?: number;
  /** Lockfile at the root, when present. A frozen install needs one — `npm ci` fails without it. */
  lockfile?: string;
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
  let managerMajor: number | undefined;
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
        const [name, spec] = pkg.packageManager.split('@');
        if (name === 'pnpm' || name === 'yarn' || name === 'npm' || name === 'bun') manager = name;
        const major = Number.parseInt(spec ?? '', 10);
        if (Number.isFinite(major)) managerMajor = major;
      }
      hasTailwind =
        pkg.dependencies?.tailwindcss !== undefined ||
        pkg.devDependencies?.tailwindcss !== undefined;
    } catch {
      // A malformed package.json is the project's problem; fall back to defaults.
    }
  }
  // The lockfile is looked up even when `packageManager` already named the manager: a frozen
  // install needs the file to exist, and the renderer cannot tell otherwise. When the manager is
  // pinned, only that manager's lockfile counts.
  let lockfile: string | undefined;
  for (const [file, name] of LOCKFILES) {
    if (packageManager !== undefined && name !== manager) continue;
    if (existsSync(path.join(root, file))) {
      lockfile = file;
      if (packageManager === undefined) manager = name;
      break;
    }
  }
  const info: PackageInfo = { manager, hasTailwind };
  if (packageManager !== undefined) info.packageManager = packageManager;
  if (managerMajor !== undefined) info.managerMajor = managerMajor;
  if (lockfile !== undefined) info.lockfile = lockfile;
  return info;
}

/**
 * Actions for the generated workflow, pinned to full commit SHAs — GitHub documents only a SHA as
 * immutable, and this mirrors the pinning policy of this repo's own CI. Bump these together with
 * `.github/workflows/ci.yml`.
 */
const ACTIONS = {
  checkout: 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1', // v7.0.1
  setupNode: 'actions/setup-node@820762786026740c76f36085b0efc47a31fe5020', // v7.0.0
  pnpmSetup: 'pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413', // v6.1.0
  setupBun: 'oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6', // v2
  uploadSarif: 'github/codeql-action/upload-sarif@d8073367669608af8fbcc5f63dd0a0d52bb90cff', // v4
} as const;

/** pnpm major written into `action-setup` when the project pins no `packageManager`. */
const PNPM_FALLBACK_MAJOR = 10;

/** Install command for the manager, narrowed by whether a lockfile is actually there. */
function installRun(info: PackageInfo, frozen: boolean): string {
  switch (info.manager) {
    case 'pnpm':
      return `      - run: pnpm install ${frozen ? '--frozen-lockfile' : '--no-frozen-lockfile'}\n`;
    case 'yarn':
      if (!frozen) return '      - run: yarn install\n';
      if (info.managerMajor === 1) return '      - run: yarn install --frozen-lockfile\n';
      if (info.managerMajor !== undefined) return '      - run: yarn install --immutable\n';
      // Without a pinned major the flag cannot be chosen: Yarn 1 rejects `--immutable` and
      // Yarn 2+ rejects `--frozen-lockfile`. Install plainly and say what to add.
      return '      - run: yarn install # pin packageManager, then add --immutable (Yarn 2+) or --frozen-lockfile (Yarn 1)\n';
    case 'bun':
      return `      - run: bun install${frozen ? ' --frozen-lockfile' : ''}\n`;
    default:
      return `      - run: npm ${frozen ? 'ci' : 'install'}\n`;
  }
}

function installSteps(info: PackageInfo): string {
  const frozen = info.lockfile !== undefined;
  let setup = '';
  if (info.manager === 'pnpm') {
    // `pnpm/action-setup` requires `version` unless the project pins `packageManager`, and stops
    // the job when it finds neither: https://github.com/pnpm/action-setup#version
    setup =
      info.packageManager !== undefined
        ? `      - uses: ${ACTIONS.pnpmSetup}\n`
        : `      - uses: ${ACTIONS.pnpmSetup}\n        with:\n          version: ${PNPM_FALLBACK_MAJOR} # no packageManager in package.json; match your pnpm\n`;
  } else if (info.manager === 'bun') {
    setup = `      - uses: ${ACTIONS.setupBun}\n`;
  }
  // `setup-node`'s cache needs a lockfile to hash; it fails the step when there is none.
  const cache = frozen ? `\n          cache: ${info.manager}` : '';
  const node =
    info.manager === 'bun'
      ? ''
      : `      - uses: ${ACTIONS.setupNode}\n        with:\n          node-version: 20${cache}\n`;
  return setup + node + installRun(info, frozen);
}

/**
 * Command that runs tw-ghost in CI, pinned to the version that wrote the workflow. The generated
 * workflow installs the project's dependencies but does not add tw-ghost to them.
 *
 * `npx` and `bunx` prefer a locally installed binary and fall back to the registry. `pnpm dlx` and
 * `yarn dlx` always fetch into a temporary environment — they do not use an installed copy. Pinning
 * `@${VERSION}` makes every path run one version, so a later release cannot change a project's CI
 * without a commit.
 *
 * Yarn 1 has no `dlx`, so it runs through `npx`; npm is available in every Yarn project.
 */
function runner(info: PackageInfo): string {
  const pkg = `tw-ghost@${VERSION}`;
  switch (info.manager) {
    case 'pnpm':
      return `pnpm dlx ${pkg}`;
    case 'yarn':
      return info.managerMajor !== undefined && info.managerMajor >= 2
        ? `yarn dlx ${pkg}`
        : `npx ${pkg}`;
    case 'bun':
      return `bunx ${pkg}`;
    default:
      return `npx ${pkg}`;
  }
}

export interface WorkflowOptions {
  info: PackageInfo;
  /** `--config` argument for the generated commands; omitted when auto-detection is enough. */
  config?: string | undefined;
  /** Branch for the `push:` filter. Default: `main`, with a note that it was not detected. */
  branch?: string | undefined;
  sarif: boolean;
}

/**
 * Quote a value as a YAML single-quoted scalar.
 *
 * Applied unconditionally, including to branch names: `git check-ref-format --branch` accepts
 * `release,2026`, `feat#1`, `a{b}` and `o'brien`, and bare in a flow sequence those parse as two
 * items, as null, or not at all. Deciding per value which names are YAML-safe is the bug this
 * avoids — only a space and `*` are actually rejected by git.
 */
function yamlSingleQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Default branch of the repository at `root`, read from `origin/HEAD` (set by `git clone`).
 * Undefined when there is no git repo or no remote HEAD.
 */
function detectDefaultBranch(root: string): string | undefined {
  try {
    const ref = execFileSync('git', ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const name = ref.replace(/^origin\//, '');
    return name.length > 0 ? name : undefined;
  } catch {
    return undefined;
  }
}

export function renderWorkflow(options: WorkflowOptions): string {
  const { info, sarif } = options;
  const run = runner(info);
  if (options.config?.includes('\n')) {
    throw new TwGhostConfigError('--config: path must not contain a newline');
  }
  // The config path travels through `env`, not the `run:` string: a path with a space would split
  // into two arguments, and quotes or shell metacharacters would change the command.
  const configEnv = options.config
    ? `    env:\n      TW_GHOST_CONFIG: ${yamlSingleQuote(options.config)}\n`
    : '';
  const configArg = options.config ? ' --config "$TW_GHOST_CONFIG"' : '';
  const branch = options.branch ?? 'main';
  const branchNote =
    options.branch === undefined
      ? ' # default branch not detected — change this if yours is not main'
      : '';
  const permissions = sarif
    ? 'permissions:\n  contents: read\n  security-events: write # upload-sarif\n'
    : 'permissions:\n  contents: read\n';
  // Which exit codes may become a code-scanning baseline. 1 is "ghosts found" — the scan finished,
  // so the log is complete and uploading it is the point of the job. 2 is "tw-ghost could not
  // finish" (a config failed to load): that config contributes no run, and uploading the remainder
  // would retire its existing alerts as though its classes had been fixed. Any other code is
  // unexplained, so the gate lists what may upload instead of using `if: always()`.
  const uploadIf =
    // biome-ignore lint/suspicious/noTemplateCurlyInString: `${{ }}` is the Actions expression syntax
    "${{ !cancelled() && (steps.scan.outputs.code == '0' || steps.scan.outputs.code == '1') }}";
  const analyzeStep = sarif
    ? [
        '      # SARIF goes to a file. Ghosts still fail the job; `code` decides whether the partial',
        '      # log may be uploaded (exit 2 = a config failed to load, so it may not).',
        '      - id: scan',
        '        run: |',
        '          code=0',
        `          ${run} --format sarif${configArg} > tw-ghost.sarif || code=$?`,
        '          echo "code=$code" >> "$GITHUB_OUTPUT"',
        '          exit "$code"',
        `      - if: ${uploadIf}`,
        `        uses: ${ACTIONS.uploadSarif}`,
        '        with:',
        '          sarif_file: tw-ghost.sarif',
        '          category: tw-ghost',
        '',
      ].join('\n')
    : `      - run: ${run} --format github${configArg}\n`;
  return `# Written by tw-ghost ${VERSION} (\`tw-ghost init\`).
# Fails the check when a Tailwind class in this project produces no CSS.
# Docs: https://github.com/changbaebang/tw-ghost#readme
name: tw-ghost

on:
  push:
    branches: [${yamlSingleQuote(branch)}]${branchNote}
  pull_request:

${permissions}
jobs:
  tw-ghost:
    runs-on: ubuntu-latest
${configEnv}    steps:
      - uses: ${ACTIONS.checkout}
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
  const branch = options.branch ?? detectDefaultBranch(root);
  if (branch !== undefined) workflowOptions.branch = branch;
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
