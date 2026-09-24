import { describe, expect, it } from 'vitest';
import { analyze } from '../src/index.js';
import { fixture } from './helpers.js';

// The `--json` document is `{ version, ...report }`. Its shape is a stable surface (README, "What is
// stable"): a key may be *added* in a minor release; none is removed or re-typed outside a major.
// This test is the tripwire. Adding a key: extend the list here and note it in the changelog.
// Removing or renaming one: that is a major, and this failure is the reminder.
describe('--json contract: Report key sets', () => {
  it('keeps the documented keys on the report, its findings, locations and summary', async () => {
    const report = await analyze({
      cwd: fixture('replaced-scale'),
      unknown: true,
      suggestions: true,
    });
    const keys = (o: object): string[] => Object.keys(o).sort();

    expect(keys(report)).toEqual([
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
    ]);
    expect(keys(report.summary)).toEqual([
      'ghost',
      'ok',
      'unknown',
      'unknownUtilityLike',
      'unknownVariant',
    ]);

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
