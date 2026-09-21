import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  analyze,
  analyzeMany,
  isConfigFailure,
  resolveConfigPaths,
  TwGhostConfigError,
} from '../src/index.js';
import { fixture } from './helpers.js';

const monorepo = fixture('monorepo');
const ghostsOf = (r: { ghosts: Array<{ class: string }> }) => r.ghosts.map((g) => g.class);

describe('resolveConfigPaths', () => {
  it('returns [] when neither --config nor --all-configs is given (auto-detect)', async () => {
    await expect(resolveConfigPaths({ cwd: monorepo })).resolves.toEqual([]);
  });

  it('resolves plain paths from cwd without touching the filesystem', async () => {
    const paths = await resolveConfigPaths({
      cwd: monorepo,
      configs: ['apps/web/tailwind.config.ts', 'does-not-exist.js'],
    });
    expect(paths).toEqual([
      path.join(monorepo, 'apps/web/tailwind.config.ts'),
      path.join(monorepo, 'does-not-exist.js'),
    ]);
  });

  it('expands globs, de-duplicates and sorts', async () => {
    const paths = await resolveConfigPaths({
      cwd: monorepo,
      configs: ['apps/*/tailwind.config.*', 'apps/web/tailwind.config.ts'],
    });
    expect(paths).toEqual([
      path.join(monorepo, 'apps/admin/tailwind.config.js'),
      path.join(monorepo, 'apps/web/tailwind.config.ts'),
    ]);
  });

  it('throws when a glob matches nothing', async () => {
    await expect(
      resolveConfigPaths({ cwd: monorepo, configs: ['nope/*/tailwind.config.js'] }),
    ).rejects.toThrow(TwGhostConfigError);
  });

  it('--all-configs discovers every config under cwd and throws when there is none', async () => {
    const paths = await resolveConfigPaths({ cwd: monorepo, all: true });
    expect(paths.map((p) => path.relative(monorepo, p))).toEqual([
      'apps/admin/tailwind.config.js',
      'apps/web/tailwind.config.ts',
    ]);
    const empty = path.join(fixture('clean'), 'src');
    await expect(resolveConfigPaths({ cwd: empty, all: true })).rejects.toThrow(
      `--all-configs found no tailwind.config.{ts,js,cjs,mjs} under ${empty}`,
    );
  });
});

describe('analyzeMany', () => {
  it('analyzes each config from its own directory and reports ghosts per config', async () => {
    const report = await analyzeMany(
      ['apps/web/tailwind.config.ts', 'apps/admin/tailwind.config.js'],
      { cwd: monorepo, suggestions: false },
    );
    expect(report.configs.map((c) => c.config)).toEqual([
      'apps/web/tailwind.config.ts',
      'apps/admin/tailwind.config.js',
    ]);
    const [web, admin] = report.configs;
    if (!web || !admin || isConfigFailure(web) || isConfigFailure(admin)) {
      throw new Error('expected two successful reports');
    }
    // web replaces fontSize: text-* ghosts, including the shared file's text-xs.
    expect(ghostsOf(web)).toEqual(['text-sm', 'text-xs']);
    // admin replaces spacing: p-* ghosts, including the shared file's p-2.
    expect(ghostsOf(admin)).toEqual(['p-2', 'p-3']);
    // The shared file is scanned by both, with paths relative to cwd.
    expect(web.filesScanned).toBe(2);
    expect(admin.filesScanned).toBe(2);
    const at = (
      r: { ghosts: Array<{ class: string; locations: Array<{ file: string }> }> },
      cls: string,
    ) => r.ghosts.find((g) => g.class === cls)?.locations.map((l) => l.file);
    expect(at(web, 'text-xs')).toEqual(['packages/shared/src/Button.tsx']);
    expect(at(web, 'text-sm')).toEqual(['apps/web/src/Page.tsx']);
    expect(at(admin, 'p-2')).toEqual(['packages/shared/src/Button.tsx']);
    expect(at(admin, 'p-3')).toEqual(['apps/admin/src/Page.tsx']);
    expect(report.summary).toEqual({
      configs: 2,
      failed: 0,
      filesScanned: 4,
      candidateCount: web.candidateCount + admin.candidateCount,
      ok: web.summary.ok + admin.summary.ok,
      ghost: 4,
      unknown: web.summary.unknown + admin.summary.unknown,
      unknownVariant: 0,
      unknownUtilityLike: 0,
    });
    expect(report.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('matches analyze() for a single config', async () => {
    const single = await analyze({
      cwd: monorepo,
      config: 'apps/web/tailwind.config.ts',
      suggestions: false,
    });
    const many = await analyzeMany(['apps/web/tailwind.config.ts'], {
      cwd: monorepo,
      suggestions: false,
    });
    const [entry] = many.configs;
    if (!entry || isConfigFailure(entry)) throw new Error('expected a report');
    const { config, durationMs: _d1, ...rest } = entry;
    const { durationMs: _d2, ...expected } = single;
    expect(config).toBe('apps/web/tailwind.config.ts');
    expect(rest).toEqual(expected);
  });

  it('applies positional globs to every config', async () => {
    const report = await analyzeMany(
      ['apps/web/tailwind.config.ts', 'apps/admin/tailwind.config.js'],
      { cwd: monorepo, globs: ['packages/shared/**/*.tsx'], suggestions: false },
    );
    for (const entry of report.configs) {
      if (isConfigFailure(entry)) throw new Error(entry.error);
      expect(entry.filesScanned).toBe(1);
    }
    expect(report.summary.ghost).toBe(2);
  });

  it('keeps going when one config throws and counts it in summary.failed', async () => {
    const report = await analyzeMany(
      ['../broken-config/tailwind.config.js', 'apps/web/tailwind.config.ts', 'missing.config.js'],
      { cwd: monorepo, suggestions: false },
    );
    expect(report.configs.map((c) => (isConfigFailure(c) ? 'failed' : 'ok'))).toEqual([
      'failed',
      'ok',
      'failed',
    ]);
    const [broken, , missing] = report.configs;
    expect(broken).toMatchObject({
      config: '../broken-config/tailwind.config.js',
      error: expect.stringContaining('boom: this config cannot be loaded'),
    });
    expect(missing).toMatchObject({
      config: 'missing.config.js',
      error: expect.stringContaining('Config file not found'),
    });
    expect(report.summary).toMatchObject({ configs: 3, failed: 2, ghost: 2 });
  });
});
