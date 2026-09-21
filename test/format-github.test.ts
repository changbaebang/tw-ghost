import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { GhostFinding, Report } from '../src/analyze.js';
import {
  annotation,
  escapeData,
  escapeProperty,
  formatGithub,
  relativizeFile,
} from '../src/format-github.js';

const ghost = (cls: string, locs: Array<[string, number, number]>, suggestions: string[] = []) =>
  ({
    class: cls,
    count: locs.length,
    locations: locs.map(([file, line, col]) => ({ file, line, col })),
    stockCss: [],
    suggestions,
  }) satisfies GhostFinding;

const report = (partial: Partial<Report>): Report => ({
  configPath: '/repo/tailwind.config.js',
  tailwindVersion: '3.4.0',
  extractor: 'project',
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

describe('escaping (workflow-command spec)', () => {
  it('escapes %, CR and LF in message data', () => {
    expect(escapeData('100%\r\nnext')).toBe('100%25%0D%0Anext');
  });

  it('additionally escapes : and , in property values', () => {
    expect(escapeProperty('a:b,c%')).toBe('a%3Ab%2Cc%25');
  });

  it('escapes the file property and the message but keeps : and , in the message', () => {
    const line = annotation(
      'error',
      { file: 'x', line: 3, col: 4 },
      'src/a,b:c.tsx',
      'tw-ghost',
      'w-[50%] produces no CSS — try: a, b',
    );
    expect(line).toBe(
      '::error file=src/a%2Cb%3Ac.tsx,line=3,col=4,title=tw-ghost::w-[50%25] produces no CSS — try: a, b',
    );
  });
});

describe('relativizeFile', () => {
  it('is relative to the workspace when the file lives under it', () => {
    const ws = path.resolve('/ws/repo');
    expect(relativizeFile('src/App.tsx', path.join(ws, 'apps/web'), ws)).toBe(
      'apps/web/src/App.tsx',
    );
  });

  it('stays relative to cwd when the file is outside the workspace or there is none', () => {
    const cwd = path.resolve('/elsewhere/project');
    expect(relativizeFile('src/App.tsx', cwd, path.resolve('/ws/repo'))).toBe('src/App.tsx');
    expect(relativizeFile('src/App.tsx', cwd, undefined)).toBe('src/App.tsx');
  });
});

describe('formatGithub', () => {
  const saved = process.env.GITHUB_WORKSPACE;
  afterEach(() => {
    if (saved === undefined) delete process.env.GITHUB_WORKSPACE;
    else process.env.GITHUB_WORKSPACE = saved;
  });

  it('emits one ::error per occurrence with suggestions, and a summary', () => {
    delete process.env.GITHUB_WORKSPACE;
    const cwd = path.resolve('/proj');
    const r = report({
      ghosts: [
        ghost(
          'text-sm',
          [
            ['src/a.tsx', 1, 2],
            ['src/b.tsx', 3, 4],
          ],
          ['text-m', 'text-s'],
        ),
        ghost('p-3', [['src/a.tsx', 5, 6]]),
      ],
    });
    const { output, summary, omitted } = formatGithub(r, { cwd });
    expect(output.split('\n')).toEqual([
      '::error file=src/a.tsx,line=1,col=2,title=tw-ghost::text-sm produces no CSS in this Tailwind config — try: text-m, text-s',
      '::error file=src/b.tsx,line=3,col=4,title=tw-ghost::text-sm produces no CSS in this Tailwind config — try: text-m, text-s',
      '::error file=src/a.tsx,line=5,col=6,title=tw-ghost::p-3 produces no CSS in this Tailwind config',
    ]);
    expect(summary).toBe('tw-ghost: 2 ghost classes, 3 occurrences');
    expect(omitted).toBe(0);
  });

  it('reads GITHUB_WORKSPACE from the environment', () => {
    process.env.GITHUB_WORKSPACE = path.resolve('/ws');
    const r = report({ ghosts: [ghost('p-3', [['src/a.tsx', 1, 1]])] });
    expect(formatGithub(r, { cwd: path.resolve('/ws/pkg') }).output).toContain(
      'file=pkg/src/a.tsx,',
    );
    delete process.env.GITHUB_WORKSPACE;
    expect(formatGithub(r, { cwd: path.resolve('/ws/pkg') }).output).toContain('file=src/a.tsx,');
  });

  it('caps annotations and reports the rest in a ::notice', () => {
    delete process.env.GITHUB_WORKSPACE;
    const r = report({
      ghosts: [
        ghost('p-3', [
          ['a', 1, 1],
          ['a', 2, 1],
          ['a', 3, 1],
          ['a', 4, 1],
        ]),
      ],
    });
    const { output, omitted } = formatGithub(r, { cwd: '/p', maxAnnotations: 2 });
    expect(output.split('\n')).toHaveLength(3);
    expect(output.endsWith('\n::notice::tw-ghost: 2 more annotations omitted')).toBe(true);
    expect(omitted).toBe(2);
    expect(formatGithub(r, { cwd: '/p', maxAnnotations: 0 }).output.split('\n')).toHaveLength(4);
  });

  it('turns unknown / unknown-variant findings into ::warning with the (unknown) title', () => {
    delete process.env.GITHUB_WORKSPACE;
    const r = report({
      unknown: [{ class: 'text-smm', count: 1, locations: [{ file: 'a', line: 1, col: 1 }] }],
      unknownVariant: [
        { class: 'bogus:p-4', count: 1, locations: [{ file: 'a', line: 2, col: 1 }] },
      ],
    });
    const lines = formatGithub(r, { cwd: '/p' }).output.split('\n');
    expect(lines[0]).toMatch(
      /^::warning file=a,line=1,col=1,title=tw-ghost \(unknown\)::text-smm /,
    );
    expect(lines[1]).toMatch(
      /^::warning file=a,line=2,col=1,title=tw-ghost \(unknown\)::bogus:p-4/,
    );
  });

  it('prints nothing but a summary on a clean report', () => {
    const { output, summary } = formatGithub(report({}), { cwd: '/p' });
    expect(output).toBe('');
    expect(summary).toBe('tw-ghost: 0 ghost classes, 0 occurrences');
  });
});
