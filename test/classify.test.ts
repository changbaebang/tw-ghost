import { describe, expect, it } from 'vitest';
import {
  classify,
  collectRoots,
  isPlausibleVariantChain,
  looksUtilityLike,
  splitVariants,
  utilityPart,
  utilityRoot,
} from '../src/classify.js';
import { stockConfigFrom } from '../src/generate.js';
import { assertSupportedTailwind, assertTailwindV3, unwrapDefaultExport } from '../src/project.js';
import { changedThemeKeys, flattenThemeKeys } from '../src/suggest.js';

describe('classify', () => {
  const project = new Set(['text-m', 'p-4', 'md:p-4', 'md:text-m']);
  const stock = new Set(['text-sm', 'p-4', 'p-3', 'md:text-sm', 'md:p-4', 'md:text-m']);

  it('is ok when the project config emits the class (even if stock also does)', () => {
    expect(classify('text-m', project, stock)).toBe('ok');
    expect(classify('p-4', project, stock)).toBe('ok');
    expect(classify('md:p-4', project, stock)).toBe('ok');
  });
  it('is ghost when only stock emits the class', () => {
    expect(classify('text-sm', project, stock)).toBe('ghost');
    expect(classify('p-3', project, stock)).toBe('ghost');
    expect(classify('md:text-sm', project, stock)).toBe('ghost');
  });
  it('is unknown when neither emits the class', () => {
    expect(classify('swiper-slide', project, stock)).toBe('unknown');
    expect(classify('text-smm', project, stock)).toBe('unknown');
    expect(classify('hocus:text-smm', project, stock)).toBe('unknown');
  });

  describe('variant-bearing candidate in neither set → judged by its bare utility', () => {
    it('is ghost when the bare utility is stock-only (project-defined or unknown variants alike)', () => {
      expect(classify('tablet:text-sm', project, stock)).toBe('ghost');
      expect(classify('hocus:text-sm', project, stock)).toBe('ghost');
      expect(classify('dark:md:hover:text-sm', project, stock)).toBe('ghost');
      expect(classify('bogus:p-3', project, stock)).toBe('ghost');
      expect(classify('[&_svg]:p-3', project, stock)).toBe('ghost');
      expect(classify('data-[state="open"]:p-3', project, stock)).toBe('ghost');
    });
    it('is unknown-variant when the bare utility works in the project', () => {
      expect(classify('bogus:p-4', project, stock)).toBe('unknown-variant');
      expect(classify('tablet:text-m', project, stock)).toBe('unknown-variant');
    });
    it('honours the configured separator', () => {
      expect(classify('md_hover_text-sm', project, stock, '_')).toBe('ghost');
      expect(classify('md_hover_p-4', project, stock, '_')).toBe('unknown-variant');
      // with `_` as separator, `:` is not a variant boundary at all
      expect(classify('md:hover:text-sm', project, stock, '_')).toBe('unknown');
    });
    it('splits only at bracket depth 0, so `:` inside an arbitrary value is not a variant', () => {
      expect(classify('bg-[url(data:image/png;base64,x)]', project, stock)).toBe('unknown');
      const stockWithFill = new Set([...stock, 'fill-current']);
      expect(classify('[&_svg]:fill-current', project, stockWithFill)).toBe('ghost');
    });
    it('does not judge extractor noise by its bare utility', () => {
      expect(classify('class="tablet:text-sm', project, stock)).toBe('unknown');
      expect(classify("clsx('md:p-4", project, stock)).toBe('unknown');
    });
  });
});

describe('splitVariants', () => {
  it('splits at the last top-level separator, keeping the trailing separator on the chain', () => {
    expect(splitVariants('md:hover:!-m-4')).toEqual({ variants: 'md:hover:', utility: '!-m-4' });
    expect(splitVariants('p-4')).toEqual({ variants: '', utility: 'p-4' });
    expect(splitVariants('[&_svg]:fill-current')).toEqual({
      variants: '[&_svg]:',
      utility: 'fill-current',
    });
    expect(splitVariants('supports-[display:grid]:p-4')).toEqual({
      variants: 'supports-[display:grid]:',
      utility: 'p-4',
    });
  });
  it('ignores separators inside brackets and supports multi-character separators', () => {
    expect(splitVariants('bg-[url(data:image/png;base64,x)]')).toEqual({
      variants: '',
      utility: 'bg-[url(data:image/png;base64,x)]',
    });
    expect(splitVariants('md__hover__p-4', '__')).toEqual({
      variants: 'md__hover__',
      utility: 'p-4',
    });
    expect(splitVariants('md_p-4', '_')).toEqual({ variants: 'md_', utility: 'p-4' });
  });
});

describe('isPlausibleVariantChain', () => {
  it('accepts real variant chains', () => {
    for (const chain of [
      'md:',
      'dark:md:hover:',
      'group-hover/edit:',
      '*:',
      '@md:',
      '2xl:',
      '[&_svg]:',
      'data-[state="open"]:',
      'supports-[display:grid]:',
      'min-[320px]:',
    ]) {
      expect(isPlausibleVariantChain(chain), chain).toBe(true);
    }
    expect(isPlausibleVariantChain('md_hover_', '_')).toBe(true);
  });
  it('rejects extractor noise and unbalanced brackets', () => {
    for (const chain of [
      '',
      'class="tablet:',
      "clsx('md:",
      'x=md:',
      '{md:',
      '[&_svg:',
      'a]:',
      'a b:',
    ]) {
      expect(isPlausibleVariantChain(chain), chain).toBe(false);
    }
  });
});

describe('utilityPart / utilityRoot', () => {
  it('strips variants, important and negative markers', () => {
    expect(utilityPart('md:hover:!-m-4')).toBe('m-4');
    expect(utilityPart('[&_svg]:fill-current')).toBe('fill-current');
    expect(utilityPart('group-[.is-open]:text-sm')).toBe('text-sm');
    expect(utilityPart('p-4')).toBe('p-4');
    expect(utilityPart('md_hover_!-tw-m-4', '_')).toBe('tw-m-4');
  });
  it('does not split on ":" inside arbitrary values', () => {
    expect(utilityPart('bg-[url(data:image/png;base64,x)]')).toBe(
      'bg-[url(data:image/png;base64,x)]',
    );
  });
  it('returns the segment before the first dash as root', () => {
    expect(utilityRoot('text-sm')).toBe('text');
    expect(utilityRoot('flex')).toBe('flex');
  });
});

describe('looksUtilityLike', () => {
  const roots = collectRoots(['text-sm', 'p-4', 'md:hover:px-2', 'acme-btn-primary']);

  it('accepts utility-shaped names whose root is a core or observed utility root', () => {
    expect(looksUtilityLike('text-smm', roots)).toBe(true);
    expect(looksUtilityLike('md:hover:text-smm', roots)).toBe(true);
    expect(looksUtilityLike('!-mt-3', roots)).toBe(true);
    expect(looksUtilityLike('acme-btn-secondary', roots)).toBe(true);
  });
  it('rejects plain words, custom CSS classes and HTML attribute vocabulary', () => {
    expect(looksUtilityLike('flex', roots)).toBe(false);
    expect(looksUtilityLike('swiper-slide', roots)).toBe(false);
    expect(looksUtilityLike('data-testid', roots)).toBe(false);
    expect(looksUtilityLike('aria-hidden', roots)).toBe(false);
    expect(looksUtilityLike('https://example.com', roots)).toBe(false);
    expect(looksUtilityLike('Text-sm', roots)).toBe(false);
    expect(looksUtilityLike('class="md:text-smm', roots)).toBe(false);
  });
  it('rejects template-literal stubs that end in a dash or separator', () => {
    expect(looksUtilityLike('max-h-', roots)).toBe(false);
    expect(looksUtilityLike('before:content-', roots)).toBe(false);
    expect(looksUtilityLike('md:', roots)).toBe(false);
    expect(looksUtilityLike('max-h-4', roots)).toBe(true);
  });
  it('uses the configured separator for the variant / utility split', () => {
    const underscoreRoots = collectRoots(['tw-text-sm', 'md_hover_tw-px-2'], '_');
    expect(underscoreRoots.has('tw')).toBe(true);
    expect(looksUtilityLike('md_tw-text-smm', underscoreRoots, '_')).toBe(true);
    expect(looksUtilityLike('md_', underscoreRoots, '_')).toBe(false);
  });
});

describe('assertSupportedTailwind (assertTailwindV3 alias)', () => {
  it('accepts 3.3.0 and every later 3.x', () => {
    for (const v of ['3.3.0', '3.3.7', '3.4.0', '3.4.17', '3.4.19', '3.5.0']) {
      expect(() => assertSupportedTailwind(v), v).not.toThrow();
      expect(() => assertTailwindV3(v), v).not.toThrow();
    }
  });
  it('rejects v4 naming the version, the supported range, v3-only and the docs link', () => {
    expect(() => assertSupportedTailwind('4.1.14')).toThrow(
      /found 4\.1\.14, tw-ghost supports 3\.3\.x – 3\.4\.x only.*v3-only.*#requirements--compatibility/,
    );
  });
  it('rejects v2 / v1 with an upgrade hint', () => {
    expect(() => assertSupportedTailwind('2.2.19')).toThrow(
      /found 2\.2\.19.*upgrade to tailwindcss 3\.3\.0 or newer/,
    );
    expect(() => assertSupportedTailwind('1.9.6')).toThrow(/found 1\.9\.6/);
  });
  it('rejects 3.0–3.2 with "found x, need >=3.3.0"', () => {
    for (const v of ['3.0.0', '3.1.8', '3.2.7']) {
      expect(() => assertSupportedTailwind(v), v).toThrow(
        new RegExp(`found ${v.replace(/\./g, '\\.')}, need >=3\\.3\\.0.*loadConfig`),
      );
    }
  });
  it('rejects garbage version strings', () => {
    expect(() => assertSupportedTailwind('next')).toThrow(/Unsupported Tailwind CSS version/);
  });
});

describe('unwrapDefaultExport', () => {
  it('unwraps { default: config } module records (Tailwind 3.3.0 + ESM config)', () => {
    const config = { content: ['./src/**/*.html'] };
    expect(unwrapDefaultExport({ default: config })).toBe(config);
    expect(unwrapDefaultExport({ default: config, __esModule: true })).toBe(config);
  });
  it('leaves real configs, primitives and functions alone', () => {
    const config = { content: [], theme: { extend: {} }, default: { nope: true } };
    expect(unwrapDefaultExport(config)).toBe(config);
    expect(unwrapDefaultExport(null)).toBe(null);
    expect(unwrapDefaultExport('x')).toBe('x');
    const fn = () => ({});
    expect(unwrapDefaultExport(fn)).toBe(fn);
    expect(unwrapDefaultExport({ default: fn })).toEqual({ default: fn });
  });
});

describe('flattenThemeKeys', () => {
  it('flattens nested sections the way Tailwind names classes', () => {
    expect(
      flattenThemeKeys({
        s: '12px',
        acme: { DEFAULT: '#000', light: '#fff' },
        gray: { 50: '#eee' },
      }),
    ).toEqual(['s', 'acme', 'acme-light', 'gray-50']);
  });
  it('returns nothing for non-object sections', () => {
    expect(flattenThemeKeys(undefined)).toEqual([]);
    expect(flattenThemeKeys('12px')).toEqual([]);
  });
});

describe('changedThemeKeys', () => {
  const fake = (theme: Record<string, unknown>, stockTheme: Record<string, unknown>) =>
    ({ resolved: { theme }, stockResolved: { theme: stockTheme } }) as never;
  it('collects keys only from sections whose key set differs from stock', () => {
    const keys = changedThemeKeys(
      fake(
        { fontSize: { s: 1, m: 2 }, zIndex: { 10: 1 } },
        { fontSize: { sm: 1 }, zIndex: { 10: 1 } },
      ),
    );
    expect(keys.sort()).toEqual(['m', 's']);
  });
  it('is empty when the theme matches stock', () => {
    expect(changedThemeKeys(fake({ zIndex: { 10: 1 } }, { zIndex: { 10: 1 } }))).toEqual([]);
  });
});

describe('stockConfigFrom', () => {
  const config = {
    prefix: 'tw-',
    separator: '_',
    important: '#app',
    darkMode: 'class',
    theme: { spacing: {}, extend: { screens: { tablet: '900px' } } },
    plugins: [() => {}],
    presets: [{}],
    safelist: ['x'],
    corePlugins: { preflight: false },
  };
  it('keeps prefix/separator/important/darkMode and drops theme, plugins, presets, safelist', () => {
    expect(stockConfigFrom(config)).toEqual({
      prefix: 'tw-',
      separator: '_',
      important: '#app',
      darkMode: 'class',
    });
  });
  it('uses the screens it is given (analyze passes default + project screens merged)', () => {
    const screens = { sm: '640px', tablet: '900px' };
    expect(stockConfigFrom(config, { screens }).theme).toEqual({ screens });
  });
});
