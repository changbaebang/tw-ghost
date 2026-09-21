import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CLI, fixture } from './helpers.js';

function run(args: string[], cwd: string) {
  // Strip the real Actions environment so `--format github` output is cwd-relative here;
  // the GITHUB_WORKSPACE behaviour has its own test that sets it explicitly.
  const { GITHUB_WORKSPACE: _drop, ...env } = process.env;
  const res = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', env });
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

  it('--format github prints one ::error per occurrence, all locations, summary on stderr', () => {
    const { code, stdout, stderr } = run(
      ['--format', 'github', '--max-locations', '1'],
      fixture('replaced-scale'),
    );
    expect(code).toBe(1);
    expect(stderr).toBe('tw-ghost: 5 ghost classes, 8 occurrences\n');
    const lines = stdout.split('\n');
    expect(lines.slice(0, 4)).toEqual([
      '::error file=src/App.tsx,line=7,col=21,title=tw-ghost::text-sm produces no CSS in this Tailwind config — try: text-l, text-m, text-s, text-xs',
      '::error file=src/App.tsx,line=8,col=88,title=tw-ghost::text-sm produces no CSS in this Tailwind config — try: text-l, text-m, text-s, text-xs',
      '::error file=src/App.tsx,line=11,col=57,title=tw-ghost::text-sm produces no CSS in this Tailwind config — try: text-l, text-m, text-s, text-xs',
      '::error file=src/index.html,line=2,col=13,title=tw-ghost::text-sm produces no CSS in this Tailwind config — try: text-l, text-m, text-s, text-xs',
    ]);
    expect(lines).toContain(
      '::error file=src/App.tsx,line=7,col=44,title=tw-ghost::z-10 produces no CSS in this Tailwind config — try: z-base, z-modal, z-nav',
    );
    expect(lines.filter((l) => l.startsWith('::error '))).toHaveLength(8);
    expect(lines.at(-1)).toBe('');
    expect(stdout).not.toContain('::warning');
    expect(stdout).not.toContain('::notice');
  });

  it('--format github honours --max-annotations, --unknown and GITHUB_WORKSPACE', () => {
    const capped = run(['--format', 'github', '--max-annotations', '3'], fixture('replaced-scale'));
    const lines = capped.stdout.trimEnd().split('\n');
    expect(lines).toHaveLength(4);
    expect(lines.at(-1)).toBe('::notice::tw-ghost: 5 more annotations omitted');

    const unknown = run(['--format', 'github', '--unknown'], fixture('replaced-scale'));
    expect(unknown.stdout).toContain(
      '::warning file=src/App.tsx,line=8,col=77,title=tw-ghost (unknown)::text-smm ',
    );

    const res = spawnSync(process.execPath, [CLI, '--format', 'github'], {
      cwd: fixture('replaced-scale'),
      encoding: 'utf8',
      env: { ...process.env, GITHUB_WORKSPACE: fixture('') },
    });
    expect(res.stdout).toContain('::error file=replaced-scale/src/App.tsx,line=7,col=21,');

    const clean = run(['--format', 'github'], fixture('clean'));
    expect(clean.code).toBe(0);
    expect(clean.stdout).toBe('');
    expect(clean.stderr).toBe('tw-ghost: 0 ghost classes, 0 occurrences\n');
  });

  it('--json is an alias for --format json; bad --format / --max-annotations exit 2', () => {
    const a = run(['--json'], fixture('replaced-scale'));
    const b = run(['--format', 'json'], fixture('replaced-scale'));
    const strip = (s: string) => s.replace(/"durationMs": \d+/, '');
    expect(strip(a.stdout)).toBe(strip(b.stdout));
    expect(run(['--format', 'xml'], fixture('clean')).code).toBe(2);
    expect(run(['--json', '--format', 'github'], fixture('clean')).code).toBe(2);
    expect(run(['--format', 'github', '--max-annotations', '-1'], fixture('clean')).code).toBe(2);
    expect(run(['--format', 'github', '--max-annotations', '0'], fixture('clean')).code).toBe(0);
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
