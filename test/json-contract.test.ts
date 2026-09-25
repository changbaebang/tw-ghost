import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyze } from '../src/index.js';
import { CLI, fixture, ROOT } from './helpers.js';

// `--json` is a stable surface (README, "What is stable"): a key may be *added* in a minor release;
// none is removed or re-typed outside a major. The promise covers every JSON document the CLI
// writes — single and multi analysis, single and multi `--env`, `init --json`, `--fix-map --json` —
// so each is pinned here, top level and the nested shapes that carry the data. Adding a key: extend
// the list and note it in the changelog. Removing or renaming one: that is a major, and this failure
// is the reminder. Key order is not part of the contract, hence the sorts; `version` coming first
// is, since tooling reads it before deciding how to parse the rest.
const keys = (o: object): string[] => Object.keys(o).sort();
const REPORT = [
  'candidateCount',
  'configPath',
  'durationMs',
  'extractor',
  'filesScanned',
  'ghosts',
  'separator',
  'summary',
  'tailwindVersion',
  'unknown',
  'unknownVariant',
  'warnings',
];
const SUMMARY = ['ghost', 'ok', 'unknown', 'unknownUtilityLike', 'unknownVariant'];
const ENV = [
  'configDir',
  'configPath',
  'content',
  'cwd',
  'darkMode',
  'extractor',
  'important',
  'node',
  'platform',
  'postcss',
  'prefix',
  'separator',
  'tailwind',
  'warnings',
];

function runJson(args: string[], cwd: string): Record<string, unknown> {
  const { GITHUB_WORKSPACE: _drop, ...env } = process.env;
  const res = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', env });
  expect(res.status, res.stderr).not.toBe(2); // a config error is not a document to pin
  const doc = JSON.parse(res.stdout) as Record<string, unknown>;
  expect(Object.keys(doc)[0], 'every --json document starts with version').toBe('version');
  return doc;
}

/** A throwaway copy of a fixture that resolves the repository's tailwindcss, for commands that write. */
function scratchProject(name: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'twg-json-'));
  cpSync(fixture(name), dir, { recursive: true });
  symlinkSync(path.join(ROOT, 'node_modules'), path.join(dir, 'node_modules'), 'junction');
  return dir;
}

describe('--json contract: the analysis report (programmatic)', () => {
  it('keeps the documented keys on the report, its findings, locations and summary', async () => {
    const report = await analyze({
      cwd: fixture('replaced-scale'),
      unknown: true,
      suggestions: true,
    });
    expect(keys(report)).toEqual(REPORT);
    expect(keys(report.summary)).toEqual(SUMMARY);
    const ghost = report.ghosts[0];
    expect(ghost, 'the fixture has ghosts').toBeDefined();
    if (ghost) {
      expect(keys(ghost)).toEqual([
        'class',
        'count',
        'files',
        'locations',
        'stockCss',
        'suggestions',
      ]);
      const loc = ghost.locations[0];
      expect(loc).toBeDefined();
      if (loc) expect(keys(loc)).toEqual(['col', 'file', 'line']);
    }
    const unknown = report.unknown[0];
    expect(unknown, 'the fixture has unknown classes').toBeDefined();
    // Unknown findings carry no `files` — only ghosts do (their fix-map needs the file list).
    if (unknown) expect(keys(unknown)).toEqual(['class', 'count', 'locations']);
  });
});

describe('--json contract: every document the CLI writes', () => {
  const T = { timeout: 30_000 }; // each case spawns the CLI once or twice; slow on windows-latest

  it('single analysis: version + the report', T, () => {
    const doc = runJson(['--json', '--fail-on', 'none'], fixture('replaced-scale'));
    expect(keys(doc)).toEqual(['version', ...REPORT].sort());
  });

  it(
    'multi analysis: version, configs (report or failure, each named), summary, durationMs',
    T,
    () => {
      const ok = runJson(
        ['--all-configs', '--json', '--fail-on', 'none', '--no-suggestions'],
        fixture('monorepo'),
      );
      expect(keys(ok)).toEqual(['configs', 'durationMs', 'summary', 'version']);
      const configs = ok.configs as Array<Record<string, unknown>>;
      expect(configs.length).toBeGreaterThan(1);
      for (const entry of configs) expect(keys(entry)).toEqual(['config', ...REPORT].sort());
      expect(keys(ok.summary as object)).toEqual([
        'candidateCount',
        'configs',
        'failed',
        'filesScanned',
        'ghost',
        'ok',
        'unknown',
        'unknownUtilityLike',
        'unknownVariant',
      ]);

      // A config that failed to load is `{ config, error }` and the document is still written (exit 2).
      const { GITHUB_WORKSPACE: _drop, ...env } = process.env;
      const res = spawnSync(
        process.execPath,
        [
          CLI,
          '--all-configs',
          '--config',
          '../broken-config/tailwind.config.js',
          '--json',
          '--no-suggestions',
        ],
        { cwd: fixture('monorepo'), encoding: 'utf8', env },
      );
      expect(res.status).toBe(2);
      const failed = (JSON.parse(res.stdout).configs as Array<Record<string, unknown>>).find(
        (c) => 'error' in c,
      );
      expect(failed).toBeDefined();
      if (failed) expect(keys(failed)).toEqual(['config', 'error']);
    },
  );

  it(
    '--env: version + the environment; --env --all-configs: version + configs, each named',
    T,
    () => {
      const single = runJson(['--env', '--json'], fixture('replaced-scale'));
      expect(keys(single)).toEqual(['version', ...ENV].sort());
      const many = runJson(['--env', '--all-configs', '--json'], fixture('monorepo'));
      expect(keys(many)).toEqual(['configs', 'version']);
      for (const entry of many.configs as Array<Record<string, unknown>>) {
        expect(keys(entry)).toEqual(['config', ...ENV].sort());
      }
    },
  );

  it('init --json and --fix-map --json', T, () => {
    const dir = scratchProject('replaced-scale');
    const init = runJson(['init', '--dry-run', '--json'], dir);
    expect(keys(init)).toEqual(['config', 'dryRun', 'files', 'ghosts', 'root', 'version']);
    for (const file of init.files as Array<Record<string, unknown>>) {
      expect(keys(file)).toEqual(['contents', 'path', 'status']);
    }

    writeFileSync(path.join(dir, 'map.json'), '{ "text-sm": "text-s" }\n');
    const fix = runJson(['--fix-map', 'map.json', '--json', '--fail-on', 'none'], dir);
    expect(keys(fix)).toEqual(['fix', 'version']);
    expect(keys(fix.fix as object)).toEqual(['edits', 'files', 'unmapped', 'unused', 'write']);
  });
});
