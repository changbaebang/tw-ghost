import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectPackageInfo, init, renderWorkflow } from '../src/index.js';
import { VERSION } from '../src/version.js';
import { fixture } from './helpers.js';

/** A throwaway project copied from a fixture, with node_modules linked so Tailwind resolves. */
function project(from: string, pkg?: Record<string, unknown>): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'twg-init-'));
  cpSync(fixture(from), dir, { recursive: true });
  symlinkSync(path.resolve('node_modules'), path.join(dir, 'node_modules'), 'junction');
  if (pkg) writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg));
  return dir;
}
const workflowOf = (dir: string): string =>
  readFileSync(path.join(dir, '.github', 'workflows', 'tw-ghost.yml'), 'utf8');

describe('detectPackageInfo', () => {
  it('prefers packageManager, then a lockfile, and reports tailwindcss', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'twg-pm-'));
    expect(detectPackageInfo(dir)).toEqual({ manager: 'npm', hasTailwind: false });

    writeFileSync(path.join(dir, 'yarn.lock'), '');
    expect(detectPackageInfo(dir).manager).toBe('yarn');

    writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ packageManager: 'pnpm@9.1.0', devDependencies: { tailwindcss: '3.4.19' } }),
    );
    expect(detectPackageInfo(dir)).toEqual({
      manager: 'pnpm',
      packageManager: 'pnpm@9.1.0',
      managerMajor: 9,
      hasTailwind: true,
      // yarn.lock is present but packageManager pins pnpm, so only pnpm-lock.yaml would count.
    });

    writeFileSync(path.join(dir, 'package.json'), '{ not json');
    expect(detectPackageInfo(dir).manager).toBe('yarn'); // falls back to the lockfile
  });
});

describe('renderWorkflow', () => {
  it('uses the right setup and runner per package manager, pinned to this version', () => {
    // No `lockfile` in the info: this is the "manager known, lockfile absent" path.
    const yml = (manager: 'npm' | 'pnpm' | 'yarn' | 'bun') =>
      renderWorkflow({ info: { manager, hasTailwind: true }, sarif: true });
    expect(yml('pnpm')).toContain('pnpm/action-setup@ea17c68');
    expect(yml('pnpm')).toContain(`pnpm dlx tw-ghost@${VERSION} --format sarif`);
    expect(yml('yarn')).toContain(`npx tw-ghost@${VERSION}`); // no pinned major -> no yarn dlx
    expect(yml('npm')).toContain(`npx tw-ghost@${VERSION}`);
    expect(yml('bun')).toContain('oven-sh/setup-bun@0c5077e');
    expect(yml('bun')).toContain(`bunx tw-ghost@${VERSION}`);
    expect(yml('bun')).not.toContain('actions/setup-node');
    // Every action is pinned to a 40-char SHA; a floating tag would be a regression.
    for (const manager of ['npm', 'pnpm', 'yarn', 'bun'] as const) {
      for (const ref of yml(manager).match(/uses: \S+/g) ?? []) {
        expect(ref).toMatch(/@[0-9a-f]{40}$/);
      }
    }
  });

  it('installs frozen only when a lockfile is actually present', () => {
    const yml = (info: Parameters<typeof renderWorkflow>[0]['info']) =>
      renderWorkflow({ info, sarif: false });

    // npm: `npm ci` needs a lockfile; without one it always fails.
    expect(yml({ manager: 'npm', hasTailwind: true })).toContain('npm install');
    expect(yml({ manager: 'npm', hasTailwind: true })).not.toContain('npm ci');
    expect(yml({ manager: 'npm', hasTailwind: true, lockfile: 'package-lock.json' })).toContain(
      'npm ci',
    );

    // setup-node's cache hashes the lockfile; it fails the step when there is none.
    expect(yml({ manager: 'npm', hasTailwind: true })).not.toContain('cache:');
    expect(yml({ manager: 'npm', hasTailwind: true, lockfile: 'package-lock.json' })).toContain(
      'cache: npm',
    );

    // pnpm without packageManager: action-setup needs an explicit version or the job stops.
    const lockOnly = yml({ manager: 'pnpm', hasTailwind: true, lockfile: 'pnpm-lock.yaml' });
    expect(lockOnly).toMatch(/^ +version: \d+/m); // action-setup's own `with:`, not node-version
    expect(lockOnly).toContain('pnpm install --frozen-lockfile');
    const pinned = yml({
      manager: 'pnpm',
      hasTailwind: true,
      packageManager: 'pnpm@9.1.0',
      managerMajor: 9,
      lockfile: 'pnpm-lock.yaml',
    });
    expect(pinned).not.toMatch(/^ +version: \d+/m); // action reads packageManager itself

    // Yarn 1 has no --immutable; Yarn 2+ removed --frozen-lockfile.
    const yarn1 = yml({
      manager: 'yarn',
      hasTailwind: true,
      packageManager: 'yarn@1.22.22',
      managerMajor: 1,
      lockfile: 'yarn.lock',
    });
    expect(yarn1).toContain('yarn install --frozen-lockfile');
    expect(yarn1).toContain(`npx tw-ghost@${VERSION}`); // Yarn 1 has no dlx
    const berry = yml({
      manager: 'yarn',
      hasTailwind: true,
      packageManager: 'yarn@4.5.0',
      managerMajor: 4,
      lockfile: 'yarn.lock',
    });
    expect(berry).toContain('yarn install --immutable');
    expect(berry).toContain(`yarn dlx tw-ghost@${VERSION}`);
    // Lockfile but no pinned major: neither flag is safe, so the command carries neither. The
    // trailing note names both flags, so only the part before `#` may be asserted on.
    const yarnUnknown = yml({ manager: 'yarn', hasTailwind: true, lockfile: 'yarn.lock' });
    const yarnCmd = (yarnUnknown.match(/^ +- run: yarn install.*$/m)?.[0] ?? '').split('#')[0];
    expect(yarnCmd).toContain('yarn install');
    expect(yarnCmd).not.toContain('--immutable');
    expect(yarnCmd).not.toContain('--frozen-lockfile');
    expect(yarnUnknown).toContain('pin packageManager'); // the note says what to add

    expect(yml({ manager: 'bun', hasTailwind: true, lockfile: 'bun.lock' })).toContain(
      'bun install --frozen-lockfile',
    );
    expect(yml({ manager: 'bun', hasTailwind: true })).toContain('bun install\n');
  });

  it('passes the config through env so a path with a space survives the shell', () => {
    const spaced = renderWorkflow({
      info: { manager: 'npm', hasTailwind: true },
      sarif: false,
      config: 'apps/my web/tailwind.config.ts',
    });
    expect(spaced).toContain("TW_GHOST_CONFIG: 'apps/my web/tailwind.config.ts'");
    expect(spaced).toContain('--config "$TW_GHOST_CONFIG"');
    expect(spaced).not.toContain('--config apps/my web');

    // A single quote in the path is escaped for the YAML scalar, not for the shell.
    const quoted = renderWorkflow({
      info: { manager: 'npm', hasTailwind: true },
      sarif: false,
      config: "apps/o'brien/tailwind.config.ts",
    });
    expect(quoted).toContain("TW_GHOST_CONFIG: 'apps/o''brien/tailwind.config.ts'");

    // A newline would break the YAML scalar outright.
    expect(() =>
      renderWorkflow({
        info: { manager: 'npm', hasTailwind: true },
        sarif: false,
        config: 'apps/a\nb/tailwind.config.ts',
      }),
    ).toThrow(/newline/);
  });

  it('filters push on the given branch, and says so when it had to guess', () => {
    const guessed = renderWorkflow({ info: { manager: 'npm', hasTailwind: true }, sarif: false });
    expect(guessed).toContain("branches: ['main']");
    expect(guessed).toContain('not detected');

    const trunk = renderWorkflow({
      info: { manager: 'npm', hasTailwind: true },
      sarif: false,
      branch: 'trunk',
    });
    expect(trunk).toContain("branches: ['trunk']");
    expect(trunk).not.toContain('not detected');
  });

  it('quotes branch names that git allows but a bare YAML sequence would mangle', () => {
    const branchLine = (branch: string): string => {
      const yml = renderWorkflow({
        info: { manager: 'npm', hasTailwind: true },
        sarif: false,
        branch,
      });
      return yml.match(/^ +branches: .*$/m)?.[0] ?? '';
    };
    // `git check-ref-format --branch` accepts all of these. Bare, the first splits into two items,
    // the second becomes null, and the third fails to parse at all.
    expect(branchLine('release,2026')).toContain("branches: ['release,2026']");
    expect(branchLine('null')).toContain("branches: ['null']");
    expect(branchLine('a{b}')).toContain("branches: ['a{b}']");
    // A single quote is doubled for the scalar, not escaped for a shell.
    expect(branchLine("o'brien")).toContain("branches: ['o''brien']");
  });

  it('asks for security-events only with sarif, and passes --config when it is nested', () => {
    const sarif = renderWorkflow({ info: { manager: 'npm', hasTailwind: true }, sarif: true });
    expect(sarif).toContain('security-events: write');
    expect(sarif).toContain('upload-sarif@d8073367669608af8fbcc5f63dd0a0d52bb90cff');
    // `if: always()` would upload an incomplete log too — see the gating test below.
    expect(sarif).not.toContain('if: always()');

    const gh = renderWorkflow({ info: { manager: 'npm', hasTailwind: true }, sarif: false });
    expect(gh).not.toContain('security-events');
    expect(gh).toContain('--format github');

    const nested = renderWorkflow({
      info: { manager: 'npm', hasTailwind: true },
      sarif: true,
      config: 'apps/web/tailwind.config.ts',
    });
    expect(nested).toContain("TW_GHOST_CONFIG: 'apps/web/tailwind.config.ts'");
    expect(nested).toContain('--config "$TW_GHOST_CONFIG"');
  });

  it('uploads SARIF for exit 0 and 1 but not for exit 2, and still fails the job on 1', () => {
    const yml = renderWorkflow({ info: { manager: 'npm', hasTailwind: true }, sarif: true });

    // A multi-line script, so the shell is named rather than inherited: the generated runner is
    // ubuntu-latest, but swapping it for windows-latest would hand this to PowerShell.
    expect(yml).toContain('\n        shell: bash\n        run: |\n');

    // The scan records its own exit code and then re-raises it, so ghosts (exit 1) still turn the
    // check red. Without `|| code=$?` the default `bash -e` would abort before the output is written.
    const run = yml.match(/^ {8}run: \|\n((?: {10}.*\n)+)/m)?.[1] ?? '';
    expect(
      run
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean),
    ).toEqual([
      'code=0',
      'npx tw-ghost@0.3.0 --format sarif > tw-ghost.sarif || code=$?',
      'echo "code=$code" >> "$GITHUB_OUTPUT"',
      'exit "$code"',
    ]);

    // The gate names the codes that may become a baseline, so 2 (incomplete) cannot. `!cancelled()`
    // rather than `always()`: it must run when the scan failed with 1, but not when the job was
    // cancelled and the log may be truncated.
    expect(yml.match(/^ {6}- if: (.+)$/m)?.[1]).toBe(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the Actions expression, verbatim
      "${{ !cancelled() && (steps.scan.outputs.code == '0' || steps.scan.outputs.code == '1') }}",
    );
  });
});

describe('init', () => {
  it('writes a workflow and a fix-map draft, and reports the ghost count', async () => {
    const dir = project('replaced-scale', { name: 'demo', packageManager: 'pnpm@9.0.0' });
    const result = await init({ cwd: dir });
    expect(result.config).toBe('tailwind.config.ts');
    expect(result.ghosts).toBeGreaterThan(0);
    expect(result.files.map((f) => [f.path, f.status])).toEqual([
      ['.github/workflows/tw-ghost.yml', 'created'],
      ['tw-ghost.fixes.json', 'created'],
    ]);
    expect(workflowOf(dir)).toContain(`pnpm dlx tw-ghost@${VERSION}`);
    const draft = JSON.parse(readFileSync(path.join(dir, 'tw-ghost.fixes.json'), 'utf8'));
    // Keys are bare utilities, so variants of one class collapse into a single entry: at most one
    // key per ghost, never more.
    expect(Object.keys(draft).length).toBeGreaterThan(0);
    expect(Object.keys(draft).length).toBeLessThanOrEqual(result.ghosts as number);
    expect(Object.keys(draft).every((k) => !k.includes(':'))).toBe(true);
  });

  it('is idempotent: a second run reports "exists" and changes nothing', async () => {
    const dir = project('replaced-scale');
    await init({ cwd: dir });
    const before = workflowOf(dir);
    writeFileSync(path.join(dir, '.github', 'workflows', 'tw-ghost.yml'), `${before}# edited\n`);
    const second = await init({ cwd: dir });
    expect(second.files.every((f) => f.status === 'exists')).toBe(true);
    expect(workflowOf(dir)).toBe(`${before}# edited\n`);
  });

  it('writes nothing with dryRun but still reports what it would write', async () => {
    const dir = project('replaced-scale');
    const result = await init({ cwd: dir, dryRun: true });
    expect(result.dryRun).toBe(true);
    expect(result.files.every((f) => f.status === 'created')).toBe(true);
    expect(result.files[0]?.contents).toContain('name: tw-ghost');
    expect(existsSync(path.join(dir, '.github'))).toBe(false);
    expect(existsSync(path.join(dir, 'tw-ghost.fixes.json'))).toBe(false);
  });

  it('skips the fix map when there is nothing to fix, and honours the toggles', async () => {
    const clean = await init({ cwd: project('clean') });
    expect(clean.ghosts).toBe(0);
    expect(clean.files.find((f) => f.path === 'tw-ghost.fixes.json')).toMatchObject({
      status: 'skipped',
      reason: 'no ghost classes to fix',
    });

    const dir = project('replaced-scale');
    const noExtras = await init({ cwd: dir, fixMap: false, sarif: false, workflow: 'ghosts.yml' });
    expect(noExtras.files.map((f) => f.path)).toEqual(['.github/workflows/ghosts.yml']);
    expect(readFileSync(path.join(dir, '.github', 'workflows', 'ghosts.yml'), 'utf8')).toContain(
      '--format github',
    );
  });

  it('still writes the workflow when there is no Tailwind config', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'twg-init-bare-'));
    mkdirSync(path.join(dir, 'src'));
    const result = await init({ cwd: dir });
    expect(result.config).toBeNull();
    expect(result.ghosts).toBeNull();
    expect(result.files[0]).toMatchObject({
      path: '.github/workflows/tw-ghost.yml',
      status: 'created',
    });
    expect(result.files[1]).toMatchObject({ status: 'skipped', reason: 'no Tailwind config' });
  });

  it('reports a scan failure instead of throwing, and keeps the workflow', async () => {
    const dir = project('replaced-scale');
    writeFileSync(
      path.join(dir, 'tailwind.config.ts'),
      'export default function () { return {}; }\n',
    );
    const result = await init({ cwd: dir });
    expect(result.scanError).toMatch(/function/i);
    expect(result.ghosts).toBeNull();
    expect(result.files[0]?.status).toBe('created');
  });
});
