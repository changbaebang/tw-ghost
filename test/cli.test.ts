import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CLI, fixture } from './helpers.js';

function run(args: string[], cwd: string) {
  const res = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8' });
  return { code: res.status, stdout: res.stdout, stderr: res.stderr };
}

describe('cli (dist/cli.js)', () => {
  it('has been built', () => {
    expect(existsSync(CLI)).toBe(true);
  });

  it('exits 1 with a stable --json shape when ghosts are found', () => {
    const { code, stdout, stderr } = run(
      ['--json', '--max-locations', '1'],
      fixture('replaced-scale'),
    );
    expect(code).toBe(1);
    expect(stderr).toBe('');
    const json = JSON.parse(stdout);
    expect(Object.keys(json)).toEqual([
      'version',
      'configPath',
      'tailwindVersion',
      'extractor',
      'warnings',
      'filesScanned',
      'candidateCount',
      'summary',
      'ghosts',
      'unknown',
      'unknownVariant',
      'durationMs',
    ]);
    expect(json.summary).toEqual({
      ok: expect.any(Number),
      ghost: 5,
      unknown: expect.any(Number),
      unknownVariant: 0,
      unknownUtilityLike: 1,
    });
    const ghost = json.ghosts.find((g: { class: string }) => g.class === 'text-sm');
    expect(ghost).toMatchObject({
      class: 'text-sm',
      count: 4,
      locations: [{ file: 'src/App.tsx', line: 7, col: 21 }],
      stockCss: ['font-size: 0.875rem', 'line-height: 1.25rem'],
      suggestions: expect.arrayContaining(['text-m']),
    });
    expect(json.unknown).toEqual([]);
    expect(json.unknownVariant).toEqual([]);
  });

  it('prints file:line:col and both unknown counts in human output', () => {
    const { code, stdout } = run(['--no-color'], fixture('replaced-scale'));
    expect(code).toBe(1);
    expect(stdout).toContain('5 ghost classes');
    expect(stdout).toMatch(
      /\(10 ok, 5 ghost, 0 unknown-variant, \d+ unknown of which 1 utility-like\)/,
    );
    expect(stdout).toContain('text-sm  (4 occurrences)');
    expect(stdout).toContain('src/App.tsx:7:21');
    expect(stdout).toContain('… and 1 more location');
    expect(stdout).toContain('stock: font-size: 0.875rem; line-height: 1.25rem');
    expect(stdout).not.toContain('swiper-slide');
  });

  it('exits 0 on a clean project', () => {
    const { code, stdout } = run(['--no-color'], fixture('clean'));
    expect(code).toBe(0);
    expect(stdout).toContain('No ghost classes');
  });

  it('exits 0 with --fail-on none even when ghosts exist', () => {
    const { code, stdout } = run(['--fail-on', 'none', '--json'], fixture('replaced-scale'));
    expect(code).toBe(0);
    expect(JSON.parse(stdout).ghosts.length).toBeGreaterThan(0);
  });

  it('--unknown lists utility-looking unknowns', () => {
    const { stdout } = run(['--unknown', '--json'], fixture('replaced-scale'));
    expect(JSON.parse(stdout).unknown.map((u: { class: string }) => u.class)).toEqual(['text-smm']);
  });

  describe('--unknown / --unknown-all (unknown-noise fixture)', () => {
    const cwd = fixture('unknown-noise');
    const names = (list: Array<{ class: string }>) => list.map((u) => u.class);

    it('--unknown --json: `unknown` holds the utility-like subset, sorted by count then name', () => {
      const { code, stdout } = run(['--unknown', '--json'], cwd);
      expect(code).toBe(0);
      const json = JSON.parse(stdout);
      expect(names(json.unknown)).toEqual(['text-mm', 'px-13', 'gap-2.25', 'rounded-xll']);
      expect(json.unknown.map((u: { count: number }) => u.count)).toEqual([3, 2, 1, 1]);
      expect(json.summary.unknownUtilityLike).toBe(4);
      expect(json.summary.unknown).toBeGreaterThan(4);
      expect(json.unknownVariant).toEqual([]);
    });

    it('--unknown --json excludes identifiers that merely share a utility root', () => {
      const { stdout } = run(['--unknown', '--json'], cwd);
      const listed = names(JSON.parse(stdout).unknown);
      for (const id of ['my-page', 'no-op', 'bottom-start', 'box-center', 'data-state']) {
        expect(listed, id).not.toContain(id);
      }
    });

    it('--unknown-all --json: `unknown` holds every raw unknown, summary counts unchanged', () => {
      const { stdout } = run(['--unknown', '--unknown-all', '--json'], cwd);
      const json = JSON.parse(stdout);
      const listed = names(json.unknown);
      expect(json.unknown.length).toBe(json.summary.unknown);
      expect(json.summary.unknownUtilityLike).toBe(4);
      for (const c of ['text-mm', 'my-page', 'no-op', 'bottom-start', 'box-center', 'data-state']) {
        expect(listed, c).toContain(c);
      }
      // sorted by count desc, then name
      const counts = json.unknown.map((u: { count: number }) => u.count);
      expect(counts).toEqual([...counts].sort((a, b) => b - a));
      expect(listed.indexOf('no-op')).toBeLessThan(listed.indexOf('text-mm')); // 4 > 3
      expect(listed.indexOf('bottom-start')).toBeLessThan(listed.indexOf('px-13')); // 2 = 2, b < p
    });

    it('--unknown-all without --unknown lists nothing', () => {
      const { stdout } = run(['--unknown-all', '--json'], cwd);
      expect(JSON.parse(stdout).unknown).toEqual([]);
    });

    it('human output: a header with shown / raw counts and the --unknown-all hint', () => {
      const withFlag = run(['--unknown', '--no-color'], cwd).stdout;
      expect(withFlag).toMatch(
        /\? Unknown utility-like classes \(4 shown, \d+ raw; use --unknown-all for everything\):/,
      );
      expect(withFlag).toContain('text-mm  (3 occurrences)');
      expect(withFlag.indexOf('text-mm')).toBeLessThan(withFlag.indexOf('px-13'));
      expect(withFlag).not.toContain('no-op');
      const all = run(['--unknown', '--unknown-all', '--no-color'], cwd).stdout;
      expect(all).toMatch(
        /\? Unknown classes, everything \(\d+ shown, 4 utility-like; drop --unknown-all to see only those\):/,
      );
      expect(all).toContain('no-op  (4 occurrences)');
    });
  });

  it('--unknown lists unknown-variant classes in their own section', () => {
    const { stdout } = run(['--unknown', '--no-color'], fixture('variants'));
    expect(stdout).toContain('9 ghost classes');
    expect(stdout).toContain('tablet:text-sm  (2 occurrences)');
    expect(stdout).toContain('hocus:text-sm  (1 occurrence)');
    expect(stdout).toContain('1 class with an unknown variant');
    expect(stdout).toContain('bogus:p-4');
    const withoutFlag = run(['--no-color'], fixture('variants')).stdout;
    expect(withoutFlag).not.toContain('bogus:p-4');
    expect(withoutFlag).toContain('1 unknown-variant');
  });

  it('accepts --config and positional globs from another cwd', () => {
    const { code, stdout } = run(
      ['src/index.html', '--config', 'tailwind.config.ts', '--json'],
      fixture('replaced-scale'),
    );
    expect(code).toBe(1);
    expect(JSON.parse(stdout).filesScanned).toBe(1);
  });

  it('exits 2 on unknown options, bad values and missing config', () => {
    expect(run(['--bogus'], fixture('clean')).code).toBe(2);
    expect(run(['--fail-on', 'maybe'], fixture('clean')).code).toBe(2);
    expect(run(['--max-locations', '-1'], fixture('clean')).code).toBe(2);
    const missing = run(['--config', 'missing.config.js'], fixture('clean'));
    expect(missing.code).toBe(2);
    expect(missing.stderr).toContain('not found');
  });

  it('rejects a non-integer --max-locations instead of silently truncating it', () => {
    for (const bad of ['3abc', '1.5', 'abc', '']) {
      const res = run(['--max-locations', bad], fixture('clean'));
      expect(res.code, bad).toBe(2);
      expect(res.stderr, bad).toContain('--max-locations must be a non-negative integer');
    }
    expect(run(['--max-locations', '0', '--json'], fixture('clean')).code).toBe(0);
  });

  it('exits 2 when no file matches, and 0 with --allow-empty (no Tailwind warning on stderr)', () => {
    const empty = run(['nothing/**/*.zzz', '--no-color'], fixture('clean'));
    expect(empty.code).toBe(2);
    expect(empty.stderr).toContain('No files matched "nothing/**/*.zzz"');
    expect(empty.stderr).toContain('--allow-empty');
    expect(empty.stdout).toBe('');

    const missingPath = run(['does-not-exist.html'], fixture('clean'));
    expect(missingPath.code).toBe(2);

    const allowed = run(['nothing/**/*.zzz', '--allow-empty', '--json'], fixture('clean'));
    expect(allowed.code).toBe(0);
    expect(allowed.stderr).toBe('');
    expect(JSON.parse(allowed.stdout)).toMatchObject({ filesScanned: 0, ghosts: [] });
  });

  it('supports --help and --version with exit 0', () => {
    const help = run(['--help'], fixture('clean'));
    expect(help.code).toBe(0);
    expect(help.stdout).toContain('Usage');
    expect(help.stdout).toContain('--allow-empty');
    const version = run(['--version'], fixture('clean'));
    expect(version.code).toBe(0);
    expect(version.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });
});
