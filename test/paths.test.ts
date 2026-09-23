import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BOM, splitBom, stripBom, toGlobPattern, toPosix } from '../src/paths.js';

const onWindows = process.platform === 'win32';

describe('toPosix', () => {
  it('turns OS separators into forward slashes and leaves POSIX paths alone', () => {
    expect(toPosix(path.join('src', 'a', 'b.tsx'))).toBe('src/a/b.tsx');
    expect(toPosix('src/a/b.tsx')).toBe('src/a/b.tsx');
  });
});

describe('toGlobPattern', () => {
  it('leaves an already-POSIX pattern untouched on every platform', () => {
    for (const p of ['src/**/*.tsx', '**/{a,b}/*.html', 'src/**/*.{ts,tsx}']) {
      expect(toGlobPattern(p)).toBe(p);
    }
  });

  it.runIf(onWindows)('rewrites Windows separators, which picomatch would read as escapes', () => {
    expect(toGlobPattern('src\\**\\*.tsx')).toBe('src/**/*.tsx');
    expect(toGlobPattern('.\\src\\**\\*.html')).toBe('./src/**/*.html');
    expect(toGlobPattern('C:\\proj\\src\\**\\*.tsx')).toBe('C:/proj/src/**/*.tsx');
    // negation survives the rewrite
    expect(toGlobPattern('!src\\vendor\\**')).toBe('!src/vendor/**');
  });

  it.runIf(!onWindows)('keeps backslash escapes on POSIX, where they are meaningful', () => {
    expect(toGlobPattern('src/text-\\[50%\\].tsx')).toBe('src/text-\\[50%\\].tsx');
  });
});

describe('stripBom / splitBom', () => {
  it('removes a leading UTF-8 BOM and leaves everything else alone', () => {
    expect(stripBom(`${BOM}<p class="text-sm">`)).toBe('<p class="text-sm">');
    expect(stripBom('<p class="text-sm">')).toBe('<p class="text-sm">');
    expect(stripBom(`x${BOM}y`)).toBe(`x${BOM}y`);
  });

  it('splitBom keeps the mark so it can be written back byte-for-byte', () => {
    expect(splitBom(`${BOM}a`)).toEqual([BOM, 'a']);
    expect(splitBom('a')).toEqual(['', 'a']);
  });
});
