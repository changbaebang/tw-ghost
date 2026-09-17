import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { analyze, describeEnvironment, loadProject, TwGhostConfigError } from '../src/index.js';
import { CLI, fixture, ROOT } from './helpers.js';

function run(args: string[], cwd: string) {
  const res = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8' });
  return { code: res.status, stdout: res.stdout, stderr: res.stderr };
}

const temps: string[] = [];
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

/**
 * A throwaway project: `tailwind.config.js` + `src/page.html`, and optionally a FAKE
 * `node_modules/tailwindcss` that only carries a package.json with the given version — enough for
 * the preflight to read the version and stop before loading anything.
 */
function makeProject(opts: { fakeTailwindVersion?: string; config?: string }): string {
  // realpath: macOS puts tmp under /var → /private/var, and messages print resolved paths
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'tw-ghost-preflight-')));
  temps.push(dir);
  mkdirSync(path.join(dir, 'src'), { recursive: true });
  writeFileSync(path.join(dir, 'package.json'), '{"name":"preflight-fixture"}\n');
  writeFileSync(
    path.join(dir, 'tailwind.config.js'),
    opts.config ??
      'module.exports = { content: ["./src/**/*.html"], theme: { fontSize: { m: "13px" } } };\n',
  );
  writeFileSync(path.join(dir, 'src', 'page.html'), '<p class="text-sm text-m"></p>\n');
  if (opts.fakeTailwindVersion) {
    const pkg = path.join(dir, 'node_modules', 'tailwindcss');
    mkdirSync(pkg, { recursive: true });
    writeFileSync(
      path.join(pkg, 'package.json'),
      JSON.stringify({
        name: 'tailwindcss',
        version: opts.fakeTailwindVersion,
        main: 'lib/index.js',
      }),
    );
    mkdirSync(path.join(pkg, 'lib'));
    writeFileSync(path.join(pkg, 'lib', 'index.js'), 'module.exports = () => {};\n');
  }
  return dir;
}

describe('preflight — Tailwind version (exit 2, actionable message)', () => {
  it('v4: names the version, the supported range, says v3-only and links the README', () => {
    const { code, stdout, stderr } = run(
      ['--no-color'],
      makeProject({ fakeTailwindVersion: '4.1.14' }),
    );
    expect(code).toBe(2);
    expect(stdout).toBe('');
    expect(stderr).toContain('tw-ghost: Unsupported Tailwind CSS version: found 4.1.14');
    expect(stderr).toContain('supports 3.3.x – 3.4.x only');
    expect(stderr).toContain('v3-only');
    expect(stderr).toContain('#requirements--compatibility');
  });

  it('v2: exit 2 with an upgrade hint', () => {
    const { code, stderr } = run(['--no-color'], makeProject({ fakeTailwindVersion: '2.2.19' }));
    expect(code).toBe(2);
    expect(stderr).toContain('found 2.2.19');
    expect(stderr).toContain('upgrade to tailwindcss 3.3.0 or newer');
  });

  it('3.0–3.2: exit 2 with "found 3.x.y, need >=3.3.0" instead of a stack trace', () => {
    const { code, stderr } = run(['--no-color'], makeProject({ fakeTailwindVersion: '3.2.7' }));
    expect(code).toBe(2);
    expect(stderr).toContain('found 3.2.7, need >=3.3.0');
    expect(stderr).toContain('loadConfig');
    expect(stderr).not.toContain('unexpected error');
    expect(stderr).not.toContain('    at ');
  });

  it('3.3+ whose install lacks loadConfig/resolveConfig: exit 2 naming the missing entry points', () => {
    const { code, stderr } = run(['--no-color'], makeProject({ fakeTailwindVersion: '3.4.19' }));
    expect(code).toBe(2);
    expect(stderr).toContain(
      'does not provide "tailwindcss/loadConfig" and "tailwindcss/resolveConfig"',
    );
    expect(stderr).not.toContain('unexpected error');
  });

  it('--env exits 2 with the same message when the preflight fails', () => {
    const { code, stdout, stderr } = run(['--env'], makeProject({ fakeTailwindVersion: '4.0.0' }));
    expect(code).toBe(2);
    expect(stdout).toBe('');
    expect(stderr).toContain('found 4.0.0');
  });
});

describe('preflight — tailwindcss not resolvable / --tailwind <dir>', () => {
  it('exit 2 explains where resolution starts and suggests --tailwind', () => {
    const dir = makeProject({});
    const { code, stderr } = run(['--no-color'], dir);
    expect(code).toBe(2);
    expect(stderr).toContain(`Could not resolve "tailwindcss" from ${dir}`);
    expect(stderr).toContain("Resolution starts at the config file's directory");
    expect(stderr).toContain('--tailwind <dir>');
  });

  it('--tailwind <dir> resolves tailwindcss from that directory (config still loads from its own folder)', () => {
    const dir = makeProject({});
    const { code, stdout } = run(['--json', '--tailwind', ROOT], dir);
    expect(code).toBe(1);
    const json = JSON.parse(stdout);
    expect(json.tailwindVersion).toMatch(/^3\./);
    expect(json.ghosts.map((g: { class: string }) => g.class)).toEqual(['text-sm']);
  });

  it('--tailwind pointing nowhere useful is a config error, not a crash', () => {
    const dir = makeProject({});
    expect(run(['--tailwind', 'does-not-exist'], dir).stderr).toContain(
      '--tailwind directory not found',
    );
    const res = run(['--no-color', '--tailwind', tmpdir()], dir);
    expect(res.code).toBe(2);
    expect(res.stderr).toContain('Check the --tailwind directory');
  });

  it('programmatic API: analyze({ tailwind }) and loadProject(path, { tailwindDir })', async () => {
    const dir = makeProject({});
    await expect(analyze({ cwd: dir })).rejects.toThrow(TwGhostConfigError);
    const report = await analyze({ cwd: dir, tailwind: ROOT });
    expect(report.summary.ghost).toBe(1);
    const project = loadProject(path.join(dir, 'tailwind.config.js'), { tailwindDir: ROOT });
    expect(project.tailwindPackageDir).toMatch(
      /node_modules\/(\.pnpm\/[^/]+\/node_modules\/)?tailwindcss$/,
    );
    expect(project.postcssVersion).toMatch(/^8\./);
  });
});

describe('preflight — config shape', () => {
  it('a config that exports a function is rejected with a hint (Tailwind v3 wants an object)', () => {
    const dir = makeProject({
      config: 'module.exports = () => ({ content: ["./src/**/*.html"] });\n',
    });
    const { code, stderr } = run(['--no-color', '--tailwind', ROOT], dir);
    expect(code).toBe(2);
    expect(stderr).toContain('exports a function');
    expect(stderr).toContain('plain config object');
  });

  it('null / primitive exports say what was exported', () => {
    const dir = makeProject({ config: 'module.exports = "nope";\n' });
    const { code, stderr } = run(['--no-color', '--tailwind', ROOT], dir);
    expect(code).toBe(2);
    expect(stderr).toContain('did not export a config object (got string)');
  });

  it('a require() that fails inside the config surfaces the underlying message, no stack trace', () => {
    const dir = makeProject({
      config:
        'const preset = require("@acme/preset-that-does-not-exist");\nmodule.exports = { presets: [preset], content: ["./src/**/*.html"] };\n',
    });
    const { code, stderr } = run(['--no-color', '--tailwind', ROOT], dir);
    expect(code).toBe(2);
    expect(stderr).toContain('Failed to load');
    expect(stderr).toContain("Cannot find module '@acme/preset-that-does-not-exist'");
    expect(stderr).not.toContain('unexpected error');
    expect(stderr).not.toMatch(/^\s+at /m);
  });
});

describe('warnings — degraded runs continue', () => {
  it('content.transform / content.extract: one stderr warning, scan continues, exit code unaffected', () => {
    const { code, stdout, stderr } = run(['--no-color'], fixture('content-transform'));
    expect(code).toBe(1);
    expect(stderr.match(/tw-ghost: warning:/g)).toHaveLength(1);
    expect(stderr).toContain(
      'tw-ghost: warning: content.transform/content.extract are not applied',
    );
    expect(stderr).toContain('classes produced only by a transform are not seen');
    // the transform would have turned `text-m` into `text-sm`; tw-ghost judges the raw text
    expect(stdout).toContain('text-sm  (1 occurrence)');
    expect(stdout).not.toContain('text-m  (');
  });

  it('warnings are part of the report (JSON and API), not only stderr', async () => {
    const { stdout } = run(['--json'], fixture('content-transform'));
    const json = JSON.parse(stdout);
    expect(json.warnings).toHaveLength(1);
    expect(json.warnings[0]).toMatch(/^content\.transform\/content\.extract are not applied/);
    const report = await analyze({ cwd: fixture('content-transform') });
    expect(report.warnings).toEqual(json.warnings);
    expect(report.summary.ghost).toBe(2);
  });

  it('content.relative alone is not a warning (tw-ghost already resolves from the config directory)', async () => {
    const dir = makeProject({
      config:
        'module.exports = { content: { files: ["./src/**/*.html"], relative: true }, theme: { fontSize: { m: "13px" } } };\n',
    });
    const report = await analyze({ cwd: dir, tailwind: ROOT });
    expect(report.warnings).toEqual([]);
    expect(report.filesScanned).toBe(1);
  });

  it('a clean config has no warnings', async () => {
    const report = await analyze({ cwd: fixture('clean') });
    expect(report.warnings).toEqual([]);
    expect(run(['--no-color'], fixture('clean')).stderr).toBe('');
  });
});

describe('--env', () => {
  it('prints what a bug report needs and exits 0', () => {
    const { code, stdout, stderr } = run(['--env'], fixture('replaced-scale'));
    expect(code).toBe(0);
    expect(stderr).toBe('');
    expect(stdout).toMatch(/^tw-ghost {5}\d+\.\d+\.\d+/m);
    expect(stdout).toMatch(/^node {9}v\d+/m);
    expect(stdout).toContain(`config       ${fixture('replaced-scale')}/tailwind.config.ts`);
    expect(stdout).toMatch(/^tailwindcss {2}3\.\d+\.\d+ {2}.*node_modules\/tailwindcss$/m);
    expect(stdout).toMatch(/^postcss {6}8\.\d+\.\d+ {2}.*node_modules\/postcss$/m);
    expect(stdout).toContain('extractor    project');
    expect(stdout).toContain('content      1 glob (resolved from');
    expect(stdout).toContain('               ./src/**/*.{ts,tsx,html}');
    expect(stdout).toContain('content opts relative=false transform=false extract=false');
    expect(stdout).toContain('prefix       ""');
    expect(stdout).toContain('separator    ":"');
    expect(stdout).not.toContain('warning');
  });

  it('--env --json is machine-readable and lists warnings', () => {
    const { code, stdout } = run(['--env', '--json'], fixture('content-transform'));
    expect(code).toBe(0);
    const json = JSON.parse(stdout);
    expect(json).toMatchObject({
      version: expect.any(String),
      node: process.version,
      configPath: path.join(fixture('content-transform'), 'tailwind.config.cjs'),
      tailwind: {
        version: expect.stringMatching(/^3\./),
        path: expect.stringContaining('tailwindcss'),
      },
      postcss: { version: expect.stringMatching(/^8\./) },
      extractor: 'project',
      content: {
        globs: ['./src/**/*.html'],
        nonGlobEntries: 0,
        relative: true,
        transform: true,
        extract: true,
      },
      warnings: [expect.stringContaining('content.transform/content.extract are not applied')],
    });
  });

  it('describeEnvironment() is exported for programmatic use', () => {
    const env = describeEnvironment({ cwd: fixture('no-content') });
    expect(env.content.globs).toEqual([]);
    expect(env.content.nonGlobEntries).toBe(1);
  });
});
