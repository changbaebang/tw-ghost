import { describe, expect, it } from 'vitest';
import { type CandidateOccurrences, isWholeToken, scanContent } from '../src/extract.js';

describe('isWholeToken', () => {
  const line = '<p class="text-sm md:text-sm p-3 p-30 !p-3 -p-3 legacy-text-sm p-3.5 text-sm/50">';
  const at = (needle: string, nth = 0): number => {
    let idx = -1;
    for (let i = 0; i <= nth; i += 1) idx = line.indexOf(needle, idx + 1);
    return idx;
  };

  it('accepts a candidate delimited by quotes, spaces or line ends', () => {
    expect(isWholeToken(line, at('text-sm'), 'text-sm'.length)).toBe(true);
    expect(isWholeToken('text-sm', 0, 7)).toBe(true);
    expect(isWholeToken(line, at('p-3'), 'p-3'.length)).toBe(true);
  });

  it('rejects a candidate that is part of a longer token', () => {
    expect(isWholeToken(line, at('md:text-sm') + 3, 'text-sm'.length)).toBe(false); // md:text-sm
    expect(isWholeToken(line, at('legacy-text-sm') + 7, 'text-sm'.length)).toBe(false);
    expect(isWholeToken(line, at('text-sm/50'), 'text-sm'.length)).toBe(false);
    expect(isWholeToken(line, at('p-30'), 'p-3'.length)).toBe(false);
    expect(isWholeToken(line, at('!p-3') + 1, 'p-3'.length)).toBe(false);
    expect(isWholeToken(line, at('-p-3') + 1, 'p-3'.length)).toBe(false);
    expect(isWholeToken(line, at('p-3.5'), 'p-3'.length)).toBe(false);
  });

  it('treats a dot not followed by a digit as a boundary', () => {
    expect(isWholeToken('a.text-sm', 2, 'text-sm'.length)).toBe(true);
    expect(isWholeToken('text-sm.', 0, 'text-sm'.length)).toBe(true);
  });
});

describe('scanContent', () => {
  const extractor = (content: string): string[] =>
    content.split(/[\s"<>=]+/).filter((t) => t !== '' && t !== 'p' && t !== 'class');

  it('records one location per whole-token occurrence, line and column 1-based', () => {
    const into: CandidateOccurrences = { locations: new Map() };
    scanContent(
      'src/page.html',
      '<p class="text-sm md:text-sm p-3 p-30 !p-3 -p-3">\n\n<p class="text-sm">text-sm again</p>',
      extractor,
      into,
    );
    expect(into.locations.get('text-sm')).toEqual([
      { file: 'src/page.html', line: 1, col: 11 },
      { file: 'src/page.html', line: 3, col: 11 },
      { file: 'src/page.html', line: 3, col: 20 },
    ]);
    expect(into.locations.get('p-3')).toEqual([{ file: 'src/page.html', line: 1, col: 30 }]);
    expect(into.locations.get('md:text-sm')).toEqual([{ file: 'src/page.html', line: 1, col: 19 }]);
    expect(into.locations.get('!p-3')).toHaveLength(1);
    expect(into.locations.get('-p-3')).toHaveLength(1);
    expect(into.locations.get('p-30')).toHaveLength(1);
  });

  it('drops extractor output that never appears as a whole token', () => {
    const into: CandidateOccurrences = { locations: new Map() };
    scanContent('a.html', 'legacy-text-sm', () => ['text-sm', 'legacy-text-sm'], into);
    expect(into.locations.has('text-sm')).toBe(false);
    expect(into.locations.get('legacy-text-sm')).toHaveLength(1);
  });
});
