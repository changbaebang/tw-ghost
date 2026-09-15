import { describe, expect, it } from 'vitest';
import { analyze } from '../src/index.js';
import { fixture } from './helpers.js';

const byClass = <T extends { class: string }>(list: T[], cls: string): T | undefined =>
  list.find((f) => f.class === cls);

describe('analyze — replaced-scale fixture', async () => {
  const report = await analyze({ cwd: fixture('replaced-scale'), unknown: true });
  const ghosts = report.ghosts.map((g) => g.class);

  it('uses the fixture config, the project extractor, and the project tailwind version', () => {
    expect(report.configPath.endsWith('replaced-scale/tailwind.config.ts')).toBe(true);
    expect(report.tailwindVersion).toMatch(/^3\./);
    expect(report.extractor).toBe('project');
    expect(report.filesScanned).toBe(2);
  });

  it('reports stock classes whose scale key was replaced', () => {
    expect(ghosts).toContain('text-sm');
    expect(ghosts).toContain('p-3');
    expect(ghosts).toContain('z-10');
    expect(ghosts).toContain('-m-3');
  });

  it('keeps variants intact and reports them as their own ghost', () => {
    expect(ghosts).toContain('md:hover:text-sm');
  });

  it('does not report classes the project config emits', () => {
    for (const ok of [
      'text-m',
      'p-4',
      '!p-4',
      '-m-4',
      'w-1/2',
      'w-[13px]',
      'z-nav',
      'rounded-lg',
      'text-acme',
      'bg-acme-light',
    ]) {
      expect(ghosts, ok).not.toContain(ok);
    }
  });

  it('does not report custom / unknown classes as ghosts', () => {
    expect(ghosts).not.toContain('swiper-slide');
    expect(ghosts).not.toContain('text-smm');
    expect(ghosts).not.toContain('clsx');
  });

  it('counts whole-token occurrences only (template literals, clsx() calls and html files)', () => {
    const textSm = byClass(report.ghosts, 'text-sm');
    // 4 standalone uses; the `text-sm` inside `md:hover:text-sm` is NOT counted.
    expect(textSm?.count).toBe(4);
    expect(textSm?.locations).toHaveLength(3); // default maxLocations
    expect(textSm?.locations).toEqual([
      { file: 'src/App.tsx', line: 7, col: 21 },
      { file: 'src/App.tsx', line: 8, col: 88 },
      { file: 'src/App.tsx', line: 11, col: 57 },
    ]);
  });

  it('shows what the class would have produced in stock Tailwind', () => {
    expect(byClass(report.ghosts, 'text-sm')?.stockCss).toEqual([
      'font-size: 0.875rem',
      'line-height: 1.25rem',
    ]);
    expect(byClass(report.ghosts, 'z-10')?.stockCss).toEqual(['z-index: 10']);
  });

  it('suggests project classes with the same root and property, nearest numeric key first', () => {
    expect(byClass(report.ghosts, 'p-3')?.suggestions.slice(0, 2)).toEqual(['p-2', 'p-4']);
    expect(byClass(report.ghosts, 'text-sm')?.suggestions).toEqual([
      'text-l',
      'text-m',
      'text-s',
      'text-xs',
    ]);
    expect(byClass(report.ghosts, 'md:hover:text-sm')?.suggestions).toContain('md:hover:text-m');
    expect(byClass(report.ghosts, '-m-3')?.suggestions.slice(0, 2)).toEqual(['-m-2', '-m-4']);
    expect(byClass(report.ghosts, 'z-10')?.suggestions).toEqual(['z-base', 'z-modal', 'z-nav']);
  });

  it('lists only utility-looking unknowns when asked', () => {
    const unknown = report.unknown.map((u) => u.class);
    expect(unknown).toContain('text-smm');
    expect(unknown).not.toContain('swiper-slide');
    expect(unknown).not.toContain('data-foo-bar');
    expect(unknown).not.toContain('aria-hidden');
  });

  it('keeps the raw unknown count and adds the utility-like subset to the summary', () => {
    expect(report.summary.unknown).toBeGreaterThan(report.summary.unknownUtilityLike);
    expect(report.summary.unknownUtilityLike).toBe(report.unknown.length);
    expect(report.summary.unknownVariant).toBe(0);
  });

  it('sorts ghosts by occurrence count, then name', () => {
    expect(ghosts[0]).toBe('text-sm');
    const counts = report.ghosts.map((g) => g.count);
    expect([...counts].sort((a, b) => b - a)).toEqual(counts);
  });
});

describe('analyze — options', () => {
  it('leaves unknown / unknownVariant empty unless requested, but still counts them', async () => {
    const report = await analyze({ cwd: fixture('replaced-scale') });
    expect(report.unknown).toEqual([]);
    expect(report.unknownVariant).toEqual([]);
    expect(report.summary.unknown).toBeGreaterThan(0);
    expect(report.summary.unknownUtilityLike).toBe(1);
  });

  it('--ignore drops matching classes from every bucket', async () => {
    const report = await analyze({ cwd: fixture('replaced-scale'), ignore: ['^text-', /^z-/] });
    const ghosts = report.ghosts.map((g) => g.class);
    expect(ghosts).not.toContain('text-sm');
    expect(ghosts).not.toContain('z-10');
    expect(ghosts).toContain('p-3');
  });

  it('rejects an invalid ignore regex with a config error', async () => {
    await expect(analyze({ cwd: fixture('replaced-scale'), ignore: ['('] })).rejects.toThrow(
      /Invalid --ignore/,
    );
  });

  it('maxLocations 0 keeps every location', async () => {
    const report = await analyze({ cwd: fixture('replaced-scale'), maxLocations: 0 });
    expect(byClass(report.ghosts, 'text-sm')?.locations).toEqual([
      { file: 'src/App.tsx', line: 7, col: 21 },
      { file: 'src/App.tsx', line: 8, col: 88 },
      { file: 'src/App.tsx', line: 11, col: 57 },
      { file: 'src/index.html', line: 2, col: 13 },
    ]);
  });

  it('suggestions can be disabled', async () => {
    const report = await analyze({ cwd: fixture('replaced-scale'), suggestions: false });
    expect(byClass(report.ghosts, 'p-3')?.suggestions).toEqual([]);
  });

  it('positional globs override the config content globs', async () => {
    const report = await analyze({ cwd: fixture('replaced-scale'), globs: ['src/**/*.html'] });
    expect(report.filesScanned).toBe(1);
    expect(byClass(report.ghosts, 'text-sm')?.count).toBe(1);
    expect(report.ghosts.map((g) => g.class)).not.toContain('z-10');
  });

  it('fails with a config error when no config can be found', async () => {
    await expect(analyze({ cwd: '/' })).rejects.toThrow(/No tailwind.config/);
    await expect(analyze({ cwd: fixture('clean'), config: 'nope.config.js' })).rejects.toThrow(
      /not found/,
    );
  });
});

describe('analyze — empty input', () => {
  it('throws when the globs match no file', async () => {
    await expect(analyze({ cwd: fixture('clean'), globs: ['nothing/**/*.zzz'] })).rejects.toThrow(
      /No files matched "nothing\/\*\*\/\*\.zzz"/,
    );
  });

  it('throws when a positional path does not exist', async () => {
    await expect(analyze({ cwd: fixture('clean'), globs: ['missing.html'] })).rejects.toThrow(
      /No files matched/,
    );
  });

  it('throws when the config has no string content globs', async () => {
    await expect(
      analyze({ cwd: fixture('clean'), config: fixture('no-content/tailwind.config.js') }),
    ).rejects.toThrow(/Nothing to scan/);
  });

  it('returns an empty report with allowEmpty', async () => {
    const report = await analyze({
      cwd: fixture('clean'),
      globs: ['nothing/**/*.zzz'],
      allowEmpty: true,
    });
    expect(report.filesScanned).toBe(0);
    expect(report.candidateCount).toBe(0);
    expect(report.ghosts).toEqual([]);
    expect(report.summary).toEqual({
      ok: 0,
      ghost: 0,
      unknown: 0,
      unknownVariant: 0,
      unknownUtilityLike: 0,
    });
  });
});

describe('analyze — prefix fixture', async () => {
  const report = await analyze({ cwd: fixture('prefix'), unknown: true });
  const ghosts = report.ghosts.map((g) => g.class);

  it('reports prefixed stock classes as ghosts and suggests prefixed replacements', () => {
    expect(ghosts).toContain('tw-text-sm');
    expect(ghosts).toContain('md:tw-text-sm');
    expect(byClass(report.ghosts, 'tw-text-sm')?.suggestions).toEqual(['tw-text-m', 'tw-text-s']);
    expect(byClass(report.ghosts, 'md:tw-text-sm')?.suggestions).toEqual([
      'md:tw-text-m',
      'md:tw-text-s',
    ]);
  });

  it('treats prefixed classes that exist as ok, including negative and unchanged scales', () => {
    expect(ghosts).not.toContain('tw-text-m');
    expect(ghosts).not.toContain('tw-p-4');
    expect(ghosts).not.toContain('-tw-m-4');
  });

  it('treats an unprefixed stock class as unknown, not ghost', () => {
    expect(ghosts).not.toContain('text-sm');
    expect(report.unknown.map((u) => u.class)).toContain('text-sm');
  });
});

describe('analyze — variants fixture (custom screen + addVariant + dead scales)', async () => {
  const report = await analyze({ cwd: fixture('variants'), unknown: true });
  const ghosts = report.ghosts.map((g) => g.class);

  it('reports a dead utility behind a project-defined screen or plugin variant as a ghost', () => {
    expect(ghosts).toContain('tablet:text-sm');
    expect(ghosts).toContain('hocus:text-sm');
    expect(ghosts).toContain('tablet:p-3');
    expect(ghosts).toContain('tablet:!text-sm');
    expect(ghosts).toContain('dark:md:hover:text-sm');
    expect(report.summary.ghost).toBe(9);
  });

  it('reports a stock breakpoint the project removed as a ghost, even with a live utility', () => {
    // `screens` was replaced without `xl`: stock Tailwind emits `xl:p-4`, this config does not.
    expect(ghosts).toContain('xl:p-4');
    expect(ghosts).toContain('xl:text-sm');
    expect(ghosts).not.toContain('md:p-4');
    expect(byClass(report.ghosts, 'xl:p-4')?.stockCss).toEqual(['padding: 1rem']);
  });

  it('reports a dead utility behind an arbitrary variant, without splitting inside brackets', () => {
    expect(ghosts).toContain('[&_svg]:p-3');
    expect(ghosts).not.toContain('[&_svg]:p-4');
  });

  it('keeps the same class alive when the utility exists in the project', () => {
    for (const ok of ['tablet:text-m', 'tablet:p-4', 'hocus:text-m', 'dark:md:hover:text-m']) {
      expect(ghosts, ok).not.toContain(ok);
    }
    expect(report.summary.ok).toBe(6);
  });

  it('shows the bare utility’s stock declarations and re-attaches the variant to suggestions', () => {
    const tablet = byClass(report.ghosts, 'tablet:text-sm');
    expect(tablet?.count).toBe(2);
    expect(tablet?.stockCss).toEqual(['font-size: 0.875rem', 'line-height: 1.25rem']);
    expect(tablet?.suggestions).toEqual(['tablet:text-m', 'tablet:text-s']);
    expect(byClass(report.ghosts, 'hocus:text-sm')?.suggestions).toEqual([
      'hocus:text-m',
      'hocus:text-s',
    ]);
    expect(byClass(report.ghosts, 'tablet:!text-sm')?.stockCss).toEqual([
      'font-size: 0.875rem !important',
      'line-height: 1.25rem !important',
    ]);
  });

  it('classifies a live utility under an unknown variant as unknown-variant, not ghost', () => {
    expect(ghosts).not.toContain('bogus:p-4');
    expect(report.unknownVariant.map((u) => u.class)).toEqual(['bogus:p-4']);
    expect(report.summary.unknownVariant).toBe(1);
  });

  it('still judges a dead utility under an unknown variant by its base (documented false positive)', () => {
    expect(ghosts).toContain('bogus:text-sm');
  });

  it('keeps typos and custom classes under a variant out of the ghost list', () => {
    expect(ghosts).not.toContain('hocus:text-smm');
    expect(ghosts).not.toContain('hocus:swiper-slide');
    expect(report.unknown.map((u) => u.class)).toEqual(['hocus:text-smm']);
  });
});

describe('analyze — separator fixture (separator "_" + prefix "tw-")', async () => {
  const report = await analyze({ cwd: fixture('separator'), unknown: true });
  const ghosts = report.ghosts.map((g) => g.class);

  it('classifies variant-bearing ghosts split on the configured separator', () => {
    expect(ghosts).toEqual(
      expect.arrayContaining([
        'tw-text-sm',
        'md_hover_tw-text-sm',
        'dark_md_hover_tw-text-sm',
        '-tw-mt-3',
        'md_-tw-mt-3',
        'md_!tw-p-3',
      ]),
    );
    expect(report.summary.ghost).toBe(6);
  });

  it('suggests replacements with the variant chain, "!" and "-" re-attached', () => {
    expect(byClass(report.ghosts, 'md_hover_tw-text-sm')?.suggestions).toEqual([
      'md_hover_tw-text-m',
      'md_hover_tw-text-s',
    ]);
    expect(byClass(report.ghosts, 'dark_md_hover_tw-text-sm')?.suggestions).toEqual([
      'dark_md_hover_tw-text-m',
      'dark_md_hover_tw-text-s',
    ]);
    expect(byClass(report.ghosts, 'md_-tw-mt-3')?.suggestions.slice(0, 2)).toEqual([
      'md_-tw-mt-2',
      'md_-tw-mt-4',
    ]);
    expect(byClass(report.ghosts, 'md_!tw-p-3')?.suggestions.slice(0, 2)).toEqual([
      'md_!tw-p-2',
      'md_!tw-p-4',
    ]);
  });

  it('treats ":" as an ordinary character and unprefixed classes as unknown', () => {
    expect(ghosts).not.toContain('md:tw-text-sm');
    expect(ghosts).not.toContain('text-sm');
    expect(report.unknown.map((u) => u.class)).toEqual(['md_tw-text-smm', 'text-sm']);
  });
});

describe('analyze — count fixture (whole-token occurrences)', async () => {
  const report = await analyze({ cwd: fixture('count'), maxLocations: 0 });

  it('does not count a candidate inside a longer token', () => {
    // line 1: text-sm md:text-sm p-3 p-30 !p-3 -p-3 legacy-text-sm — one real `text-sm`, one real `p-3`
    expect(byClass(report.ghosts, 'text-sm')?.locations).toEqual([
      { file: 'src/page.html', line: 1, col: 11 },
      { file: 'src/page.html', line: 2, col: 11 },
      { file: 'src/page.html', line: 2, col: 20 },
    ]);
    expect(byClass(report.ghosts, 'p-3')).toMatchObject({
      count: 1,
      locations: [{ file: 'src/page.html', line: 1, col: 30 }],
    });
    expect(byClass(report.ghosts, 'md:text-sm')).toMatchObject({
      count: 1,
      locations: [{ file: 'src/page.html', line: 1, col: 19 }],
    });
    expect(byClass(report.ghosts, '!p-3')?.count).toBe(1);
  });
});

describe('analyze — clean fixture', () => {
  it('finds no ghosts when the theme only extends stock', async () => {
    const report = await analyze({ cwd: fixture('clean') });
    expect(report.ghosts).toEqual([]);
    expect(report.summary.ghost).toBe(0);
    expect(report.summary.ok).toBeGreaterThanOrEqual(6);
  });
});
