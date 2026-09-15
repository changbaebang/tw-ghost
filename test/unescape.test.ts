import { describe, expect, it } from 'vitest';
import { unescapeCssIdentifier } from '../src/unescape.js';

describe('unescapeCssIdentifier', () => {
  it('returns plain identifiers untouched', () => {
    expect(unescapeCssIdentifier('text-sm')).toBe('text-sm');
  });

  it('unescapes the characters Tailwind escapes in class names', () => {
    expect(unescapeCssIdentifier('md\\:hover\\:text-sm')).toBe('md:hover:text-sm');
    expect(unescapeCssIdentifier('w-1\\/2')).toBe('w-1/2');
    expect(unescapeCssIdentifier('w-\\[13px\\]')).toBe('w-[13px]');
    expect(unescapeCssIdentifier('\\!p-4')).toBe('!p-4');
    expect(unescapeCssIdentifier('p-1\\.5')).toBe('p-1.5');
    expect(unescapeCssIdentifier('w-\\[50\\%\\]')).toBe('w-[50%]');
  });

  it('unescapes hex escapes with and without the terminating space', () => {
    expect(unescapeCssIdentifier('grid-cols-\\[1fr\\2c 2fr\\]')).toBe('grid-cols-[1fr,2fr]');
    expect(unescapeCssIdentifier('\\21 p-4')).toBe('!p-4');
    expect(unescapeCssIdentifier('a\\2cb')).toBe('aˋ');
  });

  it('keeps a trailing backslash literally instead of dropping it', () => {
    expect(unescapeCssIdentifier('foo\\')).toBe('foo\\');
  });
});
