import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  applyFixMap,
  applyFixMapToText,
  draftFixMap,
  parseFixMap,
  replacementFor,
} from '../src/index.js';

describe('parseFixMap', () => {
  it('accepts bare utility → string | null and drops identity entries', () => {
    expect(parseFixMap('{"text-sm":"text-l","z-10":null,"p-4":"p-4"}')).toEqual({
      'text-sm': 'text-l',
      'z-10': null,
    });
  });

  it('accepts a map written with a UTF-8 BOM (Notepad / PowerShell 5.1 Set-Content)', () => {
    expect(parseFixMap('\uFEFF{"text-sm":"text-l"}')).toEqual({ 'text-sm': 'text-l' });
  });

  it('rejects drafts that still carry candidate arrays, with a clear message', () => {
    expect(() => parseFixMap('{"text-sm":["text-l","text-m"]}', 'fixes.json')).toThrow(
      /"text-sm" still has 2 candidates/,
    );
  });

  it('rejects keys with variants, "!" or whitespace, and non-utility values', () => {
    expect(() => parseFixMap('{"md:text-sm":"text-l"}')).toThrow(/bare utility/);
    expect(() => parseFixMap('{"!text-sm":"text-l"}')).toThrow(/bare utility/);
    expect(() => parseFixMap('{"text-sm":"text l"}')).toThrow(/bare utility string or null/);
    expect(() => parseFixMap('{"text-sm":3}')).toThrow(/got 3/);
    expect(() => parseFixMap('[]')).toThrow(/expected an object/);
    expect(() => parseFixMap('{')).toThrow(/invalid JSON/);
  });
});

describe('replacementFor', () => {
  const map = { 'text-sm': 'text-l', 'mt-3': 'mt-4', 'z-10': null };
  it('carries variants, ! and - over to the replacement', () => {
    expect(replacementFor('text-sm', map)).toBe('text-l');
    expect(replacementFor('md:hover:text-sm', map)).toBe('md:hover:text-l');
    expect(replacementFor('!text-sm', map)).toBe('!text-l');
    expect(replacementFor('-mt-3', map)).toBe('-mt-4');
    expect(replacementFor('lg:!-mt-3', map)).toBe('lg:!-mt-4');
    expect(replacementFor('sm:z-10', map)).toBeNull();
  });
  it('honours a custom separator and ignores unmapped classes', () => {
    expect(replacementFor('md_hover_text-sm', map, '_')).toBe('md_hover_text-l');
    expect(replacementFor('text-base', map)).toBeUndefined();
  });
});

describe('applyFixMapToText', () => {
  const map = { 'text-sm': 'text-l', 'p-3': 'p-4', 'z-10': null };

  it('replaces whole tokens only and never touches longer tokens that contain them', () => {
    const src = `<div className="text-sm md:text-sm legacy-text-sm text-sm/50 p-3 p-30 !p-3 -p-3 p-3.5">`;
    const { text, edits } = applyFixMapToText(
      'a.tsx',
      src,
      ['text-sm', 'md:text-sm', 'p-3', '!p-3', '-p-3'],
      map,
    );
    expect(text).toBe(
      `<div className="text-l md:text-l legacy-text-sm text-sm/50 p-4 p-30 !p-4 -p-4 p-3.5">`,
    );
    // Columns are 1-based positions on the ORIGINAL line, in line order.
    const col = (token: string) => src.indexOf(token) + 1;
    expect(edits.map((e) => [e.col, e.from, e.to])).toEqual([
      [col('text-sm md'), 'text-sm', 'text-l'],
      [col('md:text-sm'), 'md:text-sm', 'md:text-l'],
      [col('p-3 p-30'), 'p-3', 'p-4'],
      [col('!p-3'), '!p-3', '!p-4'],
      [col('-p-3 p-3.5'), '-p-3', '-p-4'],
    ]);
  });

  it('removes a class and exactly one adjacent space', () => {
    expect(applyFixMapToText('a', `class="a z-10 b"`, ['z-10'], map).text).toBe(`class="a b"`);
    expect(applyFixMapToText('a', `class="z-10 b"`, ['z-10'], map).text).toBe(`class="b"`);
    expect(applyFixMapToText('a', `class="a z-10"`, ['z-10'], map).text).toBe(`class="a"`);
    expect(applyFixMapToText('a', `class="z-10"`, ['z-10'], map).text).toBe(`class=""`);
    expect(applyFixMapToText('a', 'clsx("z-10", x)', ['z-10'], map).text).toBe('clsx("", x)');
  });

  it('handles several occurrences on one line, template literals and clsx, and keeps CRLF', () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the placeholder is test *input*, not a template
    const src = 'const c = `text-sm ${x} text-sm`;\r\nclsx("text-sm", cond && "z-10")\r\n';
    const { text, edits } = applyFixMapToText('a', src, ['text-sm', 'z-10'], map);
    // biome-ignore lint/suspicious/noTemplateCurlyInString: same
    expect(text).toBe('const c = `text-l ${x} text-l`;\r\nclsx("text-l", cond && "")\r\n');
    expect(edits).toHaveLength(4);
  });

  it('preserves each line\u2019s own ending, so a mixed-EOL file is not rewritten wholesale', () => {
    // Routine on Windows: Git, editors and generators disagree within one file. Rewriting every
    // line to one "dominant" EOL would bury the real diff.
    const src = 'a text-sm\nb z-10\r\nc text-sm\nd\r\n';
    const { text, edits } = applyFixMapToText('a', src, ['text-sm', 'z-10'], map);
    expect(text).toBe('a text-l\nb\r\nc text-l\nd\r\n');
    expect(edits.map((e) => e.line)).toEqual([1, 2, 3]);
  });

  it('keeps a file with no trailing newline free of one', () => {
    expect(applyFixMapToText('a', 'x text-sm', ['text-sm'], map).text).toBe('x text-l');
    expect(applyFixMapToText('a', 'x text-sm\r\ny p-3', ['text-sm', 'p-3'], map).text).toBe(
      'x text-l\r\ny p-4',
    );
  });

  it('carries a UTF-8 BOM through untouched and does not count it as a column', () => {
    const { text, edits } = applyFixMapToText('a', '\uFEFFtext-sm p-3', ['text-sm', 'p-3'], map);
    expect(text).toBe('\uFEFFtext-l p-4');
    expect(edits.map((e) => [e.line, e.col])).toEqual([
      [1, 1],
      [1, 9],
    ]);
  });

  it('returns the identical text when nothing applies', () => {
    const src = 'class="text-base"';
    const r = applyFixMapToText('a', src, ['text-base'], map);
    expect(r.text).toBe(src);
    expect(r.edits).toEqual([]);
  });
});

describe('applyFixMap (files)', () => {
  it('dry-runs by default, writes with write: true, and reports unused / unmapped', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'twg-fix-'));
    const a = path.join(dir, 'a.tsx');
    const b = path.join(dir, 'b.tsx');
    writeFileSync(a, 'x text-sm y\n');
    writeFileSync(b, 'md:text-sm z-10\n');
    const occurrences = new Map([
      ['text-sm', new Set([a])],
      ['md:text-sm', new Set([b])],
      ['z-10', new Set([b])],
      ['rounded', new Set([b])],
    ]);
    const map = { 'text-sm': 'text-l', 'z-10': null, 'gap-1': 'gap-2' };
    const dry = await applyFixMap({ occurrences, map });
    expect(dry.edits).toHaveLength(3);
    expect(dry.files).toEqual([a, b]);
    expect(dry.unused).toEqual(['gap-1']);
    expect(dry.unmapped).toEqual(['rounded']);
    expect(readFileSync(a, 'utf8')).toBe('x text-sm y\n');
    const wet = await applyFixMap({ occurrences, map, write: true });
    expect(wet.edits).toHaveLength(3);
    expect(readFileSync(a, 'utf8')).toBe('x text-l y\n');
    expect(readFileSync(b, 'utf8')).toBe('md:text-l\n');
  });
});

describe('draftFixMap', () => {
  it('collapses variants to bare keys, keeps a single suggestion, lists several, nulls none', () => {
    const draft = draftFixMap([
      { class: 'text-sm', suggestions: ['text-l', 'text-m'] },
      { class: 'md:text-sm', suggestions: ['md:text-l', 'md:text-m', 'md:text-s'] },
      { class: 'z-10', suggestions: ['z-nav'] },
      { class: 'lg:!-mt-3', suggestions: [] },
    ]);
    expect(draft).toEqual({
      'mt-3': null,
      'text-sm': ['text-l', 'text-m', 'text-s'],
      'z-10': 'z-nav',
    });
  });
});
