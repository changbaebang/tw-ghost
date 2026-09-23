import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
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

  it('--format sarif emits a SARIF 2.1.0 log, one result per occurrence, uncapped', () => {
    const { code, stdout, stderr } = run(
      // --max-locations and --max-annotations must not reach SARIF: it reports every occurrence.
      ['--format', 'sarif', '--max-locations', '1', '--max-annotations', '1'],
      fixture('replaced-scale'),
    );
    expect(code).toBe(1);
    expect(stderr).toBe(
      'tw-ghost: 5 ghost classes, 8 occurrences \u2192 8 SARIF results in 1 run\n',
    );
    const log = JSON.parse(stdout);
    expect(log.$schema).toBe('https://json.schemastore.org/sarif-2.1.0.json');
    expect(log.version).toBe('2.1.0');
    expect(log.runs).toHaveLength(1);
    const [run0] = log.runs;
    expect(run0.tool.driver).toMatchObject({
      name: 'tw-ghost',
      informationUri: 'https://github.com/changbaebang/tw-ghost#readme',
    });
    expect(run0.tool.driver.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(run0.tool.driver.rules.map((r: { id: string }) => r.id)).toEqual(['ghost-class']);
    expect(run0.automationDetails).toBeUndefined();
    // 8 occurrences = 8 results, the same total --format github annotates.
    expect(run0.results).toHaveLength(8);
    expect(run0.results[0]).toMatchObject({
      ruleId: 'ghost-class',
      ruleIndex: 0,
      level: 'error',
      locations: [
        {
          physicalLocation: {
            artifactLocation: { uri: 'src/App.tsx', uriBaseId: '%SRCROOT%' },
            region: { startLine: 7, startColumn: 21, endColumn: 28 },
          },
        },
      ],
    });
    expect(run0.results[0].message.text).toContain(
      'text-sm produces no CSS in this Tailwind config (stock Tailwind: font-size: 0.875rem',
    );
    expect(Object.keys(run0.results[0].partialFingerprints)).toEqual(['twGhostClassV1']);
    // Same class + file in two places ⇒ one fingerprint; a different class ⇒ a different one.
    const fp = (i: number) => run0.results[i].partialFingerprints.twGhostClassV1;
    expect(fp(0)).toBe(fp(1));
    expect(fp(0)).not.toBe(run0.results.at(-1).partialFingerprints.twGhostClassV1);

    const unknown = run(['--format', 'sarif', '--unknown'], fixture('replaced-scale'));
    const unknownLog = JSON.parse(unknown.stdout);
    expect(unknownLog.runs[0].tool.driver.rules.map((r: { id: string }) => r.id)).toEqual([
      'ghost-class',
      'unknown-utility-like',
      'unknown-variant',
    ]);
    expect(
      unknownLog.runs[0].results.some(
        (r: { ruleId: string; level: string }) =>
          r.ruleId === 'unknown-utility-like' && r.level === 'note',
      ),
    ).toBe(true);

    const clean = run(['--format', 'sarif'], fixture('clean'));
    expect(clean.code).toBe(0);
    expect(JSON.parse(clean.stdout).runs[0].results).toEqual([]);
    expect(clean.stderr).toBe(
      'tw-ghost: 0 ghost classes, 0 occurrences \u2192 0 SARIF results in 1 run\n',
    );
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

describe('cli: several configs', () => {
  const monorepo = fixture('monorepo');
  const parse = (stdout: string) => JSON.parse(stdout);

  it('a single --config keeps the byte-compatible single-config JSON shape', () => {
    const viaConfig = run(
      ['--config', 'apps/web/tailwind.config.ts', '--json', '--no-suggestions'],
      monorepo,
    );
    const viaGlob = run(
      ['--config', 'apps/w*/tailwind.config.ts', '--json', '--no-suggestions'],
      monorepo,
    );
    const viaCwd = run(['--json', '--no-suggestions'], path.join(monorepo, 'apps/web'));
    expect(viaConfig.code).toBe(1);
    expect(viaGlob.code).toBe(1);
    const strip = (s: string) => s.replace(/"durationMs": \d+/, '"durationMs": 0');
    expect(strip(viaGlob.stdout)).toBe(strip(viaConfig.stdout));
    const json = parse(viaConfig.stdout);
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
    expect(json).not.toHaveProperty('configs');
    // Same ghosts as running from the app directory; only the relative file paths differ.
    expect(parse(viaCwd.stdout).ghosts.map((g: { class: string }) => g.class)).toEqual(
      json.ghosts.map((g: { class: string }) => g.class),
    );
  });

  it('--config glob → multi JSON with per-config reports and an aggregated summary', () => {
    const { code, stdout, stderr } = run(
      ['--config', 'apps/*/tailwind.config.*', '--json', '--no-suggestions'],
      monorepo,
    );
    expect(code).toBe(1);
    expect(stderr).toBe('');
    const json = parse(stdout);
    expect(Object.keys(json)).toEqual(['version', 'configs', 'summary', 'durationMs']);
    expect(json.configs.map((c: { config: string }) => c.config)).toEqual([
      'apps/admin/tailwind.config.js',
      'apps/web/tailwind.config.ts',
    ]);
    expect(Object.keys(json.configs[0])).toEqual([
      'config',
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
    expect(json.configs[0].ghosts.map((g: { class: string }) => g.class)).toEqual(['p-2', 'p-3']);
    expect(json.configs[1].ghosts.map((g: { class: string }) => g.class)).toEqual([
      'text-sm',
      'text-xs',
    ]);
    expect(json.summary).toMatchObject({ configs: 2, failed: 0, filesScanned: 4, ghost: 4 });
  });

  it('repeated --config and --all-configs find the same two configs', () => {
    const repeated = run(
      [
        '--config',
        'apps/web/tailwind.config.ts',
        '--config',
        'apps/admin/tailwind.config.js',
        '--json',
        '--no-suggestions',
      ],
      monorepo,
    );
    const all = run(['--all-configs', '--json', '--no-suggestions'], monorepo);
    expect(repeated.code).toBe(1);
    expect(all.code).toBe(1);
    const names = (s: string) => parse(s).configs.map((c: { config: string }) => c.config);
    expect(names(all.stdout)).toEqual(names(repeated.stdout));
    expect(names(all.stdout)).toHaveLength(2);
  });

  it('prints one "== config (N files, K ghosts)" block per config in human output', () => {
    const { code, stdout } = run(['--all-configs', '--no-color'], monorepo);
    expect(code).toBe(1);
    expect(stdout).toContain('== apps/admin/tailwind.config.js (2 files, 2 ghosts)');
    expect(stdout).toContain('== apps/web/tailwind.config.ts (2 files, 2 ghosts)');
    expect(stdout).toContain('total: 2 configs, 4 files');
    expect(stdout).toContain('4 ghost in');
    const admin = stdout.indexOf('== apps/admin');
    const web = stdout.indexOf('== apps/web');
    expect(stdout.slice(admin, web)).toContain('p-3  (1 occurrence)');
    expect(stdout.slice(web)).toContain('text-sm  (1 occurrence)');
  });

  it('positional globs apply to every config; --fail-on none exits 0', () => {
    const { code, stdout } = run(
      ['packages/shared/**/*.tsx', '--all-configs', '--json', '--fail-on', 'none'],
      monorepo,
    );
    expect(code).toBe(0);
    const json = parse(stdout);
    expect(json.configs.map((c: { filesScanned: number }) => c.filesScanned)).toEqual([1, 1]);
    expect(json.summary.ghost).toBe(2);
  });

  it('--all-configs exits 2 with the searched root when nothing is found', () => {
    const cwd = path.join(fixture('clean'), 'src');
    const { code, stderr, stdout } = run(['--all-configs'], cwd);
    expect(code).toBe(2);
    expect(stdout).toBe('');
    expect(stderr).toContain(`--all-configs found no tailwind.config.{ts,js,cjs,mjs} under ${cwd}`);
  });

  it('exits 2 when a --config glob matches nothing', () => {
    const { code, stderr } = run(['--config', 'nowhere/*/tailwind.config.js'], monorepo);
    expect(code).toBe(2);
    expect(stderr).toContain('matched no file');
  });

  it('reports a config that throws, keeps the others, and exits 2', () => {
    const { code, stdout, stderr } = run(
      [
        '--all-configs',
        '--config',
        '../broken-config/tailwind.config.js',
        '--json',
        '--no-suggestions',
      ],
      monorepo,
    );
    expect(code).toBe(2);
    expect(stderr).toContain('1 of 3 configs failed: ../broken-config/tailwind.config.js');
    const json = parse(stdout);
    expect(json.configs[0]).toEqual({
      config: '../broken-config/tailwind.config.js',
      error: expect.stringContaining('boom: this config cannot be loaded'),
    });
    expect(json.configs.slice(1).every((c: { error?: string }) => c.error === undefined)).toBe(
      true,
    );
    expect(json.summary).toMatchObject({ configs: 3, failed: 1, ghost: 4 });

    const human = run(
      ['--all-configs', '--config', '../broken-config/tailwind.config.js', '--no-color'],
      monorepo,
    );
    expect(human.code).toBe(2);
    expect(human.stdout).toContain('== ../broken-config/tailwind.config.js (failed)');
    expect(human.stdout).toContain('boom: this config cannot be loaded');
    expect(human.stdout).toContain('total: 3 configs, 1 failed, 4 files');
  });

  it('--env prints one block per config and honours --json', () => {
    const human = run(['--env', '--all-configs'], monorepo);
    expect(human.code).toBe(0);
    expect(human.stdout).toContain('== apps/admin/tailwind.config.js\n');
    expect(human.stdout).toContain('== apps/web/tailwind.config.ts\n');
    expect(human.stdout.match(/^tailwindcss {2}/gm)).toHaveLength(2);
    const json = run(['--env', '--all-configs', '--json'], monorepo);
    expect(json.code).toBe(0);
    const parsed = parse(json.stdout);
    expect(Object.keys(parsed)).toEqual(['version', 'configs']);
    expect(parsed.configs.map((c: { config: string }) => c.config)).toEqual([
      'apps/admin/tailwind.config.js',
      'apps/web/tailwind.config.ts',
    ]);
    expect(parsed.configs[0].content.globs).toHaveLength(2);

    const broken = run(
      ['--env', '--all-configs', '--config', '../broken-config/tailwind.config.js', '--json'],
      monorepo,
    );
    expect(broken.code).toBe(2);
    expect(parse(broken.stdout).configs[0]).toMatchObject({
      config: '../broken-config/tailwind.config.js',
      error: expect.stringContaining('boom'),
    });
  });
});

describe('cli: several configs with --format github', () => {
  it('streams annotations from every config under one cap and summarizes on stderr', () => {
    const res = run(
      ['--all-configs', '--format', 'github', '--no-suggestions'],
      fixture('monorepo'),
    );
    expect(res.code).toBe(1);
    const lines = res.stdout.trim().split('\n');
    expect(lines.every((l) => l.startsWith('::error ') || l.startsWith('::notice::'))).toBe(true);
    expect(lines.filter((l) => l.startsWith('::error ')).length).toBeGreaterThan(1);
    expect(res.stderr).toMatch(/tw-ghost: \d+ ghost classes, \d+ occurrences across 2 configs/);
    const capped = run(
      ['--all-configs', '--format', 'github', '--max-annotations', '1', '--no-suggestions'],
      fixture('monorepo'),
    );
    expect(
      capped.stdout
        .trim()
        .split('\n')
        .filter((l) => l.startsWith('::error ')).length,
    ).toBe(1);
    expect(capped.stdout).toMatch(/::notice::tw-ghost: \d+ more annotations omitted/);
  });
});

describe('cli: several configs with --format sarif', () => {
  it('emits one run per config, each with its own automationDetails id and repo-relative uris', () => {
    const { code, stdout, stderr } = run(
      ['--all-configs', '--format', 'sarif', '--no-suggestions'],
      fixture('monorepo'),
    );
    expect(code).toBe(1);
    expect(stderr).toBe(
      'tw-ghost: 4 ghost classes, 4 occurrences across 2 configs \u2192 4 SARIF results in 2 runs\n',
    );
    const log = JSON.parse(stdout);
    expect(log.version).toBe('2.1.0');
    expect(log.runs).toHaveLength(2);
    expect(
      log.runs.map((r: { automationDetails: { id: string } }) => r.automationDetails.id),
    ).toEqual(['tw-ghost/apps/admin/tailwind.config.js', 'tw-ghost/apps/web/tailwind.config.ts']);
    // Every uri is relative to the monorepo root the CLI ran in, not to each config's folder.
    const uris = log.runs.flatMap(
      (r: {
        results: Array<{
          locations: Array<{ physicalLocation: { artifactLocation: { uri: string } } }>;
        }>;
      }) => r.results.map((x) => x.locations[0]?.physicalLocation.artifactLocation.uri),
    );
    expect(uris).toEqual([
      'packages/shared/src/Button.tsx',
      'apps/admin/src/Page.tsx',
      'apps/web/src/Page.tsx',
      'packages/shared/src/Button.tsx',
    ]);
    // The shared file is a ghost under both configs, for a different class each time.
    const classes = log.runs.map((r: { results: Array<{ message: { text: string } }> }) =>
      r.results.map((x) => x.message.text.split(' ')[0]),
    );
    expect(classes).toEqual([
      ['p-2', 'p-3'],
      ['text-sm', 'text-xs'],
    ]);
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
    // the copied config must still resolve tailwindcss: link the repo's node_modules next to it.
    // 'junction' rather than 'dir': a Windows directory symlink needs Developer Mode or elevation,
    // an NTFS junction needs neither. The type is ignored on POSIX.
    symlinkSync(path.resolve('node_modules'), path.join(dir, 'node_modules'), 'junction');

    const draft = run(['--fix-map-init', 'fixes.json', '--config', 'tailwind.config.ts'], dir);
    expect(draft.code).toBe(0);
    expect(draft.stderr).toMatch(/wrote .*fixes\.json: \d+ ghost classes/);
    const drafted = JSON.parse(readFileSync(path.join(dir, 'fixes.json'), 'utf8'));
    expect(Object.keys(drafted)).toContain('text-sm');
    expect(Object.keys(drafted).every((k) => !k.includes(':'))).toBe(true);

    const again = run(['--fix-map-init', 'fixes.json', '--config', 'tailwind.config.ts'], dir);
    expect(again.code).toBe(2);
    expect(again.stderr).toContain('already exists');

    const refused = run(
      ['--fix-map', 'fixes.json', '--no-color', '--config', 'tailwind.config.ts'],
      dir,
    );
    expect(refused.code).toBe(2);
    expect(refused.stderr).toMatch(/still has \d+ candidates/);

    const decided: Record<string, string | null> = {};
    for (const key of Object.keys(drafted)) decided[key] = null;
    decided['text-sm'] = 'text-l';
    writeFileSync(path.join(dir, 'fixes.json'), JSON.stringify(decided));
    const before = readFileSync(path.join(dir, 'src', 'App.tsx'), 'utf8');

    const dry = run(
      ['--fix-map', 'fixes.json', '--no-color', '--config', 'tailwind.config.ts'],
      dir,
    );
    expect(dry.code).toBe(0);
    expect(dry.stdout).toContain('dry run');
    expect(dry.stdout).toContain('text-sm → text-l');
    expect(readFileSync(path.join(dir, 'src', 'App.tsx'), 'utf8')).toBe(before);

    const wet = run(
      ['--fix-map', 'fixes.json', '--write', '--no-color', '--config', 'tailwind.config.ts'],
      dir,
    );
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
    symlinkSync(path.resolve('node_modules'), path.join(dir, 'node_modules'), 'junction');
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
