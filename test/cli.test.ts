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
      'separator',
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

describe('cli --fix-map round trip', () => {
  it('drafts a map, refuses the draft, applies a decided map (dry run then --write)', async () => {
    const { cpSync, mkdtempSync, readFileSync, writeFileSync, symlinkSync } = await import(
      'node:fs'
    );
    const { tmpdir } = await import('node:os');
    const path = await import('node:path');
    const dir = mkdtempSync(path.join(tmpdir(), 'twg-cli-fix-'));
    cpSync(fixture('replaced-scale'), dir, { recursive: true });
    // the copied config must still resolve tailwindcss: link the repo's node_modules next to it
    symlinkSync(path.resolve('node_modules'), path.join(dir, 'node_modules'), 'dir');

    const draft = run(['--fix-map-init', 'fixes.json', '--config', 'tailwind.config.ts'], dir);
    expect(draft.code).toBe(0);
    expect(draft.stderr).toMatch(/wrote .*fixes\.json: \d+ ghost classes/);
    const drafted = JSON.parse(readFileSync(path.join(dir, 'fixes.json'), 'utf8'));
    expect(Object.keys(drafted)).toContain('text-sm');
    expect(Object.keys(drafted).every((k) => !k.includes(':'))).toBe(true);

    const again = run(['--fix-map-init', 'fixes.json', '--config', 'tailwind.config.ts'], dir);
    expect(again.code).toBe(2);
    expect(again.stderr).toContain('already exists');

    const refused = run(['--fix-map', 'fixes.json', '--config', 'tailwind.config.ts'], dir);
    expect(refused.code).toBe(2);
    expect(refused.stderr).toMatch(/still has \d+ candidates/);

    const decided: Record<string, string | null> = {};
    for (const key of Object.keys(drafted)) decided[key] = null;
    decided['text-sm'] = 'text-l';
    writeFileSync(path.join(dir, 'fixes.json'), JSON.stringify(decided));
    const before = readFileSync(path.join(dir, 'src', 'App.tsx'), 'utf8');

    const dry = run(['--fix-map', 'fixes.json', '--config', 'tailwind.config.ts'], dir);
    expect(dry.code).toBe(0);
    expect(dry.stdout).toContain('dry run');
    expect(dry.stdout).toContain('text-sm → text-l');
    expect(readFileSync(path.join(dir, 'src', 'App.tsx'), 'utf8')).toBe(before);

    const wet = run(['--fix-map', 'fixes.json', '--write', '--config', 'tailwind.config.ts'], dir);
    expect(wet.code).toBe(0);
    expect(wet.stdout).toContain('fixed');
    const after = readFileSync(path.join(dir, 'src', 'App.tsx'), 'utf8');
    expect(after).not.toBe(before);
    expect(after).toContain('text-l');
    expect(after).not.toMatch(/(^|[^-\w])text-sm($|[^-\w/])/);

    const rescan = run(['--json', '--config', 'tailwind.config.ts'], dir);
    expect(rescan.code).toBe(0);
    expect(JSON.parse(rescan.stdout).summary.ghost).toBe(0);
  });

  it('exits 1 when the map leaves ghosts unmapped, 0 with --fail-on none, and reports them', async () => {
    const { cpSync, mkdtempSync, writeFileSync, symlinkSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const path = await import('node:path');
    const dir = mkdtempSync(path.join(tmpdir(), 'twg-cli-fix2-'));
    cpSync(fixture('replaced-scale'), dir, { recursive: true });
    symlinkSync(path.resolve('node_modules'), path.join(dir, 'node_modules'), 'dir');
    writeFileSync(path.join(dir, 'fixes.json'), JSON.stringify({ 'text-sm': 'text-l' }));
    const partial = run(
      ['--fix-map', 'fixes.json', '--json', '--config', 'tailwind.config.ts'],
      dir,
    );
    expect(partial.code).toBe(1);
    const json = JSON.parse(partial.stdout);
    expect(json.fix.write).toBe(false);
    expect(json.fix.unmapped.length).toBeGreaterThan(0);
    expect(json.fix.edits.length).toBeGreaterThan(0);
    const lenient = run(
      ['--fix-map', 'fixes.json', '--fail-on', 'none', '--config', 'tailwind.config.ts'],
      dir,
    );
    expect(lenient.code).toBe(0);
    expect(lenient.stdout).toContain('unmapped');
  });
});
