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
      hasTailwind: true,
    });

    writeFileSync(path.join(dir, 'package.json'), '{ not json');
    expect(detectPackageInfo(dir).manager).toBe('yarn'); // falls back to the lockfile
  });
});

describe('renderWorkflow', () => {
  it('uses the right setup, install and runner per package manager', () => {
    const yml = (manager: 'npm' | 'pnpm' | 'yarn' | 'bun') =>
      renderWorkflow({ info: { manager, hasTailwind: true }, sarif: true });
    expect(yml('pnpm')).toContain('pnpm/action-setup@v4');
    expect(yml('pnpm')).toContain('pnpm install --frozen-lockfile');
    expect(yml('pnpm')).toContain('pnpm dlx tw-ghost --format sarif');
    expect(yml('yarn')).toContain('yarn install --immutable');
    expect(yml('yarn')).toContain('yarn dlx tw-ghost');
    expect(yml('npm')).toContain('npm ci');
    expect(yml('npm')).toContain('npx tw-ghost');
    expect(yml('bun')).toContain('oven-sh/setup-bun@v2');
    expect(yml('bun')).toContain('bunx tw-ghost');
    expect(yml('bun')).not.toContain('actions/setup-node');
  });

  it('asks for security-events only with sarif, and passes --config when it is nested', () => {
    const sarif = renderWorkflow({ info: { manager: 'npm', hasTailwind: true }, sarif: true });
    expect(sarif).toContain('security-events: write');
    expect(sarif).toContain('upload-sarif@v3');
    expect(sarif).toContain('if: always()');

    const gh = renderWorkflow({ info: { manager: 'npm', hasTailwind: true }, sarif: false });
    expect(gh).not.toContain('security-events');
    expect(gh).toContain('--format github');

    const nested = renderWorkflow({
      info: { manager: 'npm', hasTailwind: true },
      sarif: true,
      config: 'apps/web/tailwind.config.ts',
    });
    expect(nested).toContain('--config apps/web/tailwind.config.ts');
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
    expect(workflowOf(dir)).toContain('pnpm dlx tw-ghost');
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
