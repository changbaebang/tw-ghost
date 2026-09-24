import { existsSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { analyze, type Finding, type GhostFinding, type Report } from '../src/analyze.js';
import {
  encodeUriPath,
  formatSarif,
  formatSarifMany,
  GHOST_RULE_ID,
  SARIF_SCHEMA_URI,
  SARIF_URI_BASE_ID,
  SARIF_VERSION,
  type SarifLog,
  type SarifRule,
  sarifRules,
  UNKNOWN_UTILITY_RULE_ID,
  UNKNOWN_VARIANT_RULE_ID,
} from '../src/format-sarif.js';
import type { MultiReport } from '../src/multi.js';
import { fixture } from './helpers.js';

const ghost = (
  cls: string,
  locs: Array<[string, number, number]>,
  extra: Partial<GhostFinding> = {},
): GhostFinding => ({
  class: cls,
  count: locs.length,
  locations: locs.map(([file, line, col]) => ({ file, line, col })),
  files: Array.from(new Set(locs.map(([file]) => file))).sort(),
  stockCss: [],
  suggestions: [],
  ...extra,
});

const finding = (cls: string, locs: Array<[string, number, number]>): Finding => ({
  class: cls,
  count: locs.length,
  locations: locs.map(([file, line, col]) => ({ file, line, col })),
});

const report = (partial: Partial<Report>): Report => ({
  configPath: '/repo/tailwind.config.js',
  tailwindVersion: '3.4.0',
  extractor: 'project',
  separator: ':',
  warnings: [],
  filesScanned: 1,
  candidateCount: 1,
  summary: { ok: 0, ghost: 0, unknown: 0, unknownVariant: 0, unknownUtilityLike: 0 },
  ghosts: [],
  unknown: [],
  unknownVariant: [],
  durationMs: 1,
  ...partial,
});

const CWD = path.resolve('/proj');
const opts = { cwd: CWD, version: '9.9.9' } as const;

// `workspace` falls back to GITHUB_WORKSPACE; drop it so these assertions are cwd-relative.
const savedWorkspace = process.env.GITHUB_WORKSPACE;
beforeEach(() => {
  delete process.env.GITHUB_WORKSPACE;
});
afterEach(() => {
  if (savedWorkspace === undefined) delete process.env.GITHUB_WORKSPACE;
  else process.env.GITHUB_WORKSPACE = savedWorkspace;
});

describe('formatSarif: the whole log for a small report', () => {
  it('is exactly this SARIF 2.1.0 document', () => {
    const r = report({
      ghosts: [
        ghost('text-sm', [['src/App.tsx', 7, 21]], {
          stockCss: ['font-size: 0.875rem', 'line-height: 1.25rem'],
          suggestions: ['text-m', 'text-s'],
        }),
      ],
    });
    const { log } = formatSarif(r, opts);
    const [run] = log.runs;
    expect(log.$schema).toBe('https://json.schemastore.org/sarif-2.1.0.json');
    expect(log.version).toBe('2.1.0');
    expect(log.runs).toHaveLength(1);
    expect(run?.tool.driver).toMatchObject({
      name: 'tw-ghost',
      version: '9.9.9',
      semanticVersion: '9.9.9',
      informationUri: 'https://github.com/changbaebang/tw-ghost#readme',
    });
    expect(run?.columnKind).toBe('utf16CodeUnits');
    // A single run carries no automationDetails, so upload-sarif's `category:` names it.
    expect(run?.automationDetails).toBeUndefined();
    expect(run?.results).toEqual([
      {
        ruleId: 'ghost-class',
        ruleIndex: 0,
        level: 'error',
        message: {
          text: 'text-sm produces no CSS in this Tailwind config (stock Tailwind: font-size: 0.875rem; line-height: 1.25rem) — try: text-m, text-s',
        },
        locations: [
          {
            physicalLocation: {
              artifactLocation: { uri: 'src/App.tsx', uriBaseId: '%SRCROOT%' },
              // endColumn = startColumn + "text-sm".length
              region: { startLine: 7, startColumn: 21, endColumn: 28 },
            },
          },
        ],
      },
    ]);
  });

  it('emits one result per occurrence — never clipped', () => {
    const r = report({
      ghosts: [
        ghost('p-3', [
          ['a.tsx', 1, 1],
          ['a.tsx', 2, 1],
          ['b.tsx', 3, 1],
          ['b.tsx', 4, 1],
          ['b.tsx', 5, 1],
        ]),
      ],
    });
    const { log, summary } = formatSarif(r, opts);
    expect(log.runs[0]?.results).toHaveLength(5);
    expect(
      log.runs[0]?.results.map((x) => x.locations[0]?.physicalLocation.region.startLine),
    ).toEqual([1, 2, 3, 4, 5]);
    expect(summary).toBe('tw-ghost: 1 ghost class, 5 occurrences → 5 SARIF results in 1 run');
  });

  it('lists at most 3 suggestions and counts the rest off', () => {
    const many = ghost('text-sm', [['a.tsx', 1, 1]], {
      suggestions: ['text-l', 'text-m', 'text-s', 'text-xs'],
    });
    const text = formatSarif(report({ ghosts: [many] }), opts).log.runs[0]?.results[0]?.message
      .text;
    expect(text).toBe(
      'text-sm produces no CSS in this Tailwind config — try: text-l, text-m, text-s (+1 more)',
    );
  });

  it('drops the stock-CSS and try clauses when there is nothing to say', () => {
    const text = formatSarif(report({ ghosts: [ghost('p-3', [['a.tsx', 1, 1]])] }), opts).log
      .runs[0]?.results[0]?.message.text;
    expect(text).toBe('p-3 produces no CSS in this Tailwind config');
  });

  it('is a valid empty log on a clean report', () => {
    const { log, summary } = formatSarif(report({}), opts);
    expect(log.runs[0]?.results).toEqual([]);
    expect(log.runs[0]?.tool.driver.rules.map((r) => r.id)).toEqual([GHOST_RULE_ID]);
    expect(summary).toBe('tw-ghost: 0 ghost classes, 0 occurrences → 0 SARIF results in 1 run');
  });
});

describe('rules', () => {
  const ids = (rules: SarifRule[]) => rules.map((r) => r.id);

  it('declares only ghost-class when --unknown is off, and reports no unknown findings', () => {
    const r = report({
      unknown: [finding('text-smm', [['a.tsx', 1, 1]])],
      unknownVariant: [finding('bogus:p-4', [['a.tsx', 2, 1]])],
    });
    const run = formatSarif(r, opts).log.runs[0];
    expect(ids(run?.tool.driver.rules ?? [])).toEqual([GHOST_RULE_ID]);
    // A rule the run cannot produce is not declared, so its findings are not reported either.
    expect(run?.results).toEqual([]);
  });

  it('adds the two note rules with --unknown and indexes results into them', () => {
    const r = report({
      ghosts: [ghost('p-3', [['a.tsx', 1, 1]])],
      unknown: [finding('text-smm', [['a.tsx', 2, 1]])],
      unknownVariant: [finding('bogus:p-4', [['a.tsx', 3, 1]])],
    });
    const run = formatSarif(r, { ...opts, unknown: true }).log.runs[0];
    expect(ids(run?.tool.driver.rules ?? [])).toEqual([
      GHOST_RULE_ID,
      UNKNOWN_UTILITY_RULE_ID,
      UNKNOWN_VARIANT_RULE_ID,
    ]);
    expect(run?.results.map((x) => [x.ruleId, x.ruleIndex, x.level])).toEqual([
      [GHOST_RULE_ID, 0, 'error'],
      [UNKNOWN_UTILITY_RULE_ID, 1, 'note'],
      [UNKNOWN_VARIANT_RULE_ID, 2, 'note'],
    ]);
    expect(run?.results[1]?.message.text).toBe(
      'text-smm produces no CSS in stock Tailwind or this config (typo or custom CSS?)',
    );
    expect(run?.results[2]?.message.text).toBe(
      'bogus:p-4: the utility works in this config but its variant chain is unknown',
    );
  });

  it('every rule carries the descriptions, help and tags Code Scanning renders', () => {
    for (const rule of sarifRules(true)) {
      expect(rule.id).toMatch(/^[a-z-]+$/);
      expect(rule.name).toMatch(/^[A-Z][A-Za-z]+$/);
      expect(rule.shortDescription.text.length).toBeGreaterThan(0);
      expect(rule.fullDescription.text.length).toBeGreaterThan(0);
      expect(rule.help.text.length).toBeGreaterThan(0);
      expect(rule.help.markdown?.length ?? 0).toBeGreaterThan(0);
      expect(rule.properties.tags).toContain('tailwindcss');
      expect(rule.properties.tags).toContain('dead-code');
      expect(['error', 'note']).toContain(rule.defaultConfiguration.level);
    }
    expect(sarifRules(true).map((r) => r.defaultConfiguration.level)).toEqual([
      'error',
      'note',
      'note',
    ]);
  });

  it('returns fresh objects, so one log cannot mutate another', () => {
    const a = sarifRules(true);
    const b = sarifRules(true);
    expect(a).toEqual(b);
    expect(a[0]).not.toBe(b[0]);
    a[0]?.properties.tags.push('mutated');
    expect(b[0]?.properties.tags).not.toContain('mutated');
  });
});

describe('artifactLocation.uri encoding', () => {
  it('percent-encodes each segment and keeps / as the separator', () => {
    expect(encodeUriPath('src/a b/c#d.tsx')).toBe('src/a%20b/c%23d.tsx');
    expect(encodeUriPath('plain/path.tsx')).toBe('plain/path.tsx');
    expect(encodeUriPath('../outside/x.tsx')).toBe('../outside/x.tsx');
    expect(encodeUriPath('already%20encoded.tsx')).toBe('already%2520encoded.tsx');
  });

  it('reaches the emitted uri, and the fingerprint keeps the raw path', () => {
    const r = report({ ghosts: [ghost('p-3', [['src/my components/a#1.tsx', 1, 1]])] });
    const result = formatSarif(r, opts).log.runs[0]?.results[0];
    expect(result?.locations[0]?.physicalLocation.artifactLocation).toEqual({
      uri: 'src/my%20components/a%231.tsx',
      uriBaseId: SARIF_URI_BASE_ID,
    });
  });

  it('is repo-relative when the scan ran in a subdirectory of GITHUB_WORKSPACE', () => {
    const ws = path.resolve('/ws');
    const r = report({ ghosts: [ghost('p-3', [['src/App.tsx', 1, 1]])] });
    const inPkg = formatSarif(r, { ...opts, cwd: path.join(ws, 'apps/web'), workspace: ws });
    expect(inPkg.log.runs[0]?.results[0]?.locations[0]?.physicalLocation.artifactLocation.uri).toBe(
      'apps/web/src/App.tsx',
    );
  });
});

describe('partialFingerprints', () => {
  // Code scanning consumes exactly one partial fingerprint, `primaryLocationLineHash`, and
  // `upload-sarif` computes it from the checked-out source. A custom key of our own would ride along
  // in the log and never be read, so documenting move-resilient tracking on it was a claim nothing
  // honoured — that is the whole reason it is gone.
  //
  // Emitting nothing is *not* what enables the supported key: `locationUpdateCallback` looks only at
  // `partialFingerprints.primaryLocationLineHash`, so the action would have added it alongside a
  // custom key just the same. Removal takes away a false guarantee, not an obstacle.
  it('emits no partial fingerprints, leaving the supported key to upload-sarif', () => {
    const r = report({
      ghosts: [
        ghost('p-3', [
          ['src/App.tsx', 7, 1],
          ['src/App.tsx', 9, 1],
        ]),
      ],
    });
    for (const result of formatSarif(r, opts).log.runs[0]?.results ?? []) {
      expect(result).not.toHaveProperty('partialFingerprints');
    }
  });

  // What the action needs from us in exchange: a `uri` it can turn back into a file on disk. Its
  // `resolveUriToFile` ignores `uriBaseId` entirely — it decodes the percent-encoding and joins a
  // relative path onto the source root — so our URIs work because they are repo-relative, not
  // because of `%SRCROOT%`. If that stopped holding, the action would skip fingerprinting silently
  // and every alert would be tracked by location alone.
  //
  // Scope: files *under* the scanned root. See the next test for the case that falls outside it.
  it('emits uris that resolve to real files the way upload-sarif resolves them', async () => {
    const root = fixture('replaced-scale');
    const analyzed = await analyze({ cwd: root, suggestions: false });
    const results = formatSarif(analyzed, { cwd: root }).log.runs[0]?.results ?? [];
    expect(results.length).toBeGreaterThan(0);

    for (const result of results) {
      const { uri, uriBaseId } = result.locations[0]?.physicalLocation.artifactLocation ?? {};
      expect(uriBaseId).toBe(SARIF_URI_BASE_ID);
      expect(uri).toBeDefined();
      const decoded = decodeURIComponent(uri ?? '');
      expect(path.posix.isAbsolute(decoded)).toBe(false);
      expect(decoded).not.toContain('://');
      expect(existsSync(path.join(root, decoded))).toBe(true);
    }
  });

  // The boundary, pinned rather than asserted away. A `content` glob may reach above the scanned
  // directory, and `relativizeFile` falls back to a cwd-relative path for anything the workspace
  // does not cover — so tw-ghost really does emit `../`. Two things follow, and neither is a
  // guarantee this format can make:
  //
  //   * the action does not reject it. It only drops *absolute* paths outside the source root; a
  //     relative one is joined on and checked for existence, so `../x` resolves whenever something
  //     happens to sit there — possibly a file from a sibling package rather than the one scanned.
  //   * code scanning has no repo path for it either way.
  //
  // Out-of-root results are therefore outside the fingerprinting contract. In CI this is rare:
  // `GITHUB_WORKSPACE` is the checkout root, so a file anywhere under it stays repo-relative even
  // when the scan runs in a subdirectory. Whether tw-ghost should warn or refuse is a separate
  // question from what it emits, so it is filed rather than decided here.
  it('emits a cwd-relative ../ uri for a file the workspace does not cover', () => {
    const r = report({ ghosts: [ghost('p-3', [['../shared/src/Button.tsx', 1, 1]])] });
    const noWorkspace = formatSarif(r, { cwd: path.resolve('/repo/apps/web') }).log.runs[0];
    expect(noWorkspace?.results[0]?.locations[0]?.physicalLocation.artifactLocation.uri).toBe(
      '../shared/src/Button.tsx',
    );

    // With a workspace that *does* cover the file, it is repo-relative again — the CI case.
    const withWorkspace = formatSarif(r, {
      cwd: path.resolve('/repo/apps/web'),
      workspace: path.resolve('/repo'),
    }).log.runs[0];
    expect(withWorkspace?.results[0]?.locations[0]?.physicalLocation.artifactLocation.uri).toBe(
      'apps/shared/src/Button.tsx',
    );
  });
});

describe('formatSarifMany: one run per config', () => {
  const multi = (configs: MultiReport['configs']): MultiReport => ({
    configs,
    summary: {
      configs: configs.length,
      failed: configs.filter((c) => c.error !== undefined).length,
      filesScanned: 0,
      candidateCount: 0,
      ok: 0,
      ghost: 0,
      unknown: 0,
      unknownVariant: 0,
      unknownUtilityLike: 0,
    },
    durationMs: 1,
  });

  it('gives every config its own run, its own rules and its own automationDetails id', () => {
    const log: SarifLog = formatSarifMany(
      multi([
        {
          config: 'apps/web/tailwind.config.ts',
          ...report({ ghosts: [ghost('text-sm', [['apps/web/src/Page.tsx', 1, 30]])] }),
        },
        {
          config: 'apps/admin/tailwind.config.js',
          ...report({ ghosts: [ghost('p-3', [['apps/admin/src/Page.tsx', 1, 30]])] }),
        },
      ]),
      opts,
    ).log;
    expect(log.runs).toHaveLength(2);
    expect(log.runs.map((r) => r.automationDetails?.id)).toEqual([
      'tw-ghost/apps/web/tailwind.config.ts',
      'tw-ghost/apps/admin/tailwind.config.js',
    ]);
    // Paths stay repo-relative: analyzeMany reports every file relative to the shared cwd.
    expect(
      log.runs.map((r) => r.results[0]?.locations[0]?.physicalLocation.artifactLocation.uri),
    ).toEqual(['apps/web/src/Page.tsx', 'apps/admin/src/Page.tsx']);
    expect(log.runs.every((r) => r.tool.driver.rules[0]?.id === GHOST_RULE_ID)).toBe(true);
  });

  it('skips configs that failed to load and counts the rest', () => {
    const { log, summary } = formatSarifMany(
      multi([
        { config: 'broken/tailwind.config.js', error: 'boom' },
        {
          config: 'apps/web/tailwind.config.ts',
          ...report({
            ghosts: [
              ghost('p-3', [
                ['a.tsx', 1, 1],
                ['a.tsx', 2, 1],
              ]),
            ],
          }),
        },
      ]),
      opts,
    );
    expect(log.runs).toHaveLength(1);
    // The survivor keeps its own id. Deriving it from the number of successes would rename it the
    // moment a sibling broke, and Code Scanning reads a rename as a different analysis.
    expect(log.runs[0]?.automationDetails?.id).toBe('tw-ghost/apps/web/tailwind.config.ts');
    expect(summary).toBe(
      'tw-ghost: 1 ghost class, 2 occurrences across 1 config → 2 SARIF results in 1 run',
    );
  });

  it("keeps a surviving run's id identical across a sibling config failing and recovering", () => {
    const web = {
      config: 'apps/web/tailwind.config.ts',
      ...report({ ghosts: [ghost('text-sm', [['apps/web/src/Page.tsx', 1, 30]])] }),
    };
    const admin = {
      config: 'apps/admin/tailwind.config.js',
      ...report({ ghosts: [ghost('p-3', [['apps/admin/src/Page.tsx', 1, 30]])] }),
    };
    const broken = { config: 'apps/admin/tailwind.config.js', error: 'boom' };

    const ids = (entries: MultiReport['configs']): (string | undefined)[] =>
      formatSarifMany(multi(entries), opts).log.runs.map((r) => r.automationDetails?.id);

    // 2 successes -> admin breaks -> admin recovers. `web` must never be renamed: it did not change,
    // and a renamed analysis retires its alerts and opens them again as new.
    const before = ids([web, admin]);
    const during = ids([web, broken]);
    const after = ids([web, admin]);

    expect(before).toEqual([
      'tw-ghost/apps/web/tailwind.config.ts',
      'tw-ghost/apps/admin/tailwind.config.js',
    ]);
    expect(during).toEqual(['tw-ghost/apps/web/tailwind.config.ts']);
    expect(after).toEqual(before);
    expect(during[0]).toBe(before[0]);
  });

  it('is a valid log with no runs when every config failed', () => {
    const { log } = formatSarifMany(multi([{ config: 'x', error: 'boom' }]), opts);
    expect(log).toEqual({ $schema: SARIF_SCHEMA_URI, version: SARIF_VERSION, runs: [] });
  });
});

/**
 * What the official schema (https://json.schemastore.org/sarif-2.1.0.json) requires of the
 * objects tw-ghost emits. The schema itself is not fetched here (no network, no new dependency):
 * these are the `required` lists, enums and `additionalProperties: false` key sets read off it,
 * asserted against a log that exercises every branch.
 */
describe('SARIF 2.1.0 schema contract', () => {
  const log = formatSarifMany(
    {
      configs: [
        {
          config: 'a/tailwind.config.js',
          ...report({
            ghosts: [ghost('p-3', [['a.tsx', 1, 1]], { stockCss: ['padding: 0.75rem'] })],
            unknown: [finding('text-smm', [['a.tsx', 2, 1]])],
            unknownVariant: [finding('bogus:p-4', [['a.tsx', 3, 1]])],
          }),
        },
        {
          config: 'b/tailwind.config.js',
          ...report({ ghosts: [ghost('z-10', [['b.tsx', 1, 1]])] }),
        },
      ],
      summary: {
        configs: 2,
        failed: 0,
        filesScanned: 2,
        candidateCount: 2,
        ok: 0,
        ghost: 2,
        unknown: 1,
        unknownVariant: 1,
        unknownUtilityLike: 1,
      },
      durationMs: 1,
    },
    { ...opts, unknown: true },
  ).log;

  const keys = (o: object) => Object.keys(o).sort();
  const LEVELS = ['none', 'note', 'warning', 'error'];

  it('sarifLog: requires version + runs, and allows only $schema beside them', () => {
    expect(keys(log)).toEqual(['$schema', 'runs', 'version']);
    expect(log.version).toBe('2.1.0'); // schema: `const`
    expect(Array.isArray(log.runs)).toBe(true);
  });

  it('run: requires tool; columnKind/automationDetails/results are known properties', () => {
    for (const run of log.runs) {
      expect(keys(run)).toEqual(['automationDetails', 'columnKind', 'results', 'tool']);
      expect(keys(run.automationDetails ?? {})).toEqual(['id']);
      expect(typeof run.automationDetails?.id).toBe('string');
      expect(['utf16CodeUnits', 'unicodeCodePoints']).toContain(run.columnKind);
    }
  });

  it('tool requires driver; toolComponent requires name', () => {
    for (const run of log.runs) {
      expect(keys(run.tool)).toEqual(['driver']);
      expect(keys(run.tool.driver)).toEqual([
        'informationUri',
        'name',
        'rules',
        'semanticVersion',
        'version',
      ]);
      expect(run.tool.driver.name).toBe('tw-ghost');
    }
  });

  it('reportingDescriptor requires id; help is a multiformatMessageString (text required)', () => {
    for (const rule of log.runs[0]?.tool.driver.rules ?? []) {
      expect(keys(rule)).toEqual([
        'defaultConfiguration',
        'fullDescription',
        'help',
        'id',
        'name',
        'properties',
        'shortDescription',
      ]);
      expect(typeof rule.id).toBe('string');
      expect(keys(rule.shortDescription)).toEqual(['text']);
      expect(keys(rule.fullDescription)).toEqual(['text']);
      expect(keys(rule.help)).toEqual(['markdown', 'text']);
      expect(keys(rule.defaultConfiguration)).toEqual(['level']);
      expect(LEVELS).toContain(rule.defaultConfiguration.level);
      expect(keys(rule.properties)).toEqual(['tags']);
      expect(new Set(rule.properties.tags).size).toBe(rule.properties.tags.length); // uniqueItems
    }
    // toolComponent.rules is uniqueItems: no rule is declared twice inside a run
    for (const run of log.runs) {
      const ids = run.tool.driver.rules.map((x) => x.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('result requires message; ruleIndex resolves; level is in the enum', () => {
    const results = log.runs.flatMap((r) => r.results);
    expect(results.length).toBeGreaterThan(0);
    for (const run of log.runs) {
      for (const result of run.results) {
        expect(keys(result)).toEqual(['level', 'locations', 'message', 'ruleId', 'ruleIndex']);
        expect(keys(result.message)).toEqual(['text']);
        expect(typeof result.message.text).toBe('string');
        expect(LEVELS).toContain(result.level);
        expect(Number.isInteger(result.ruleIndex)).toBe(true);
        expect(result.ruleIndex).toBeGreaterThanOrEqual(-1); // schema minimum
        expect(run.tool.driver.rules[result.ruleIndex]?.id).toBe(result.ruleId);
      }
    }
  });

  it('location / physicalLocation / artifactLocation / region use only known keys', () => {
    for (const result of log.runs.flatMap((r) => r.results)) {
      expect(result.locations).toHaveLength(1);
      const location = result.locations[0];
      expect(keys(location ?? {})).toEqual(['physicalLocation']);
      const physical = location?.physicalLocation;
      expect(keys(physical ?? {})).toEqual(['artifactLocation', 'region']);
      expect(keys(physical?.artifactLocation ?? {})).toEqual(['uri', 'uriBaseId']);
      expect(physical?.artifactLocation.uriBaseId).toBe('%SRCROOT%');
      // uri must be a valid uri-reference: no raw space, no raw #
      expect(physical?.artifactLocation.uri).not.toMatch(/[ #]/);
      const region = physical?.region;
      expect(keys(region ?? {})).toEqual(['endColumn', 'startColumn', 'startLine']);
      expect(region?.startLine).toBeGreaterThanOrEqual(1); // schema minimum
      expect(region?.startColumn).toBeGreaterThanOrEqual(1);
      expect(region?.endColumn).toBeGreaterThan(region?.startColumn ?? 0);
    }
  });
});
