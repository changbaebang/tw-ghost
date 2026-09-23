import { readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyze, createLiveClassifier, TwGhostConfigError } from '../src/index.js';
import { fixture } from './helpers.js';

const configOf = (name: string): string => {
  const dir = fixture(name);
  const file = readdirSync(dir).find((n) => n.startsWith('tailwind.config.'));
  if (!file) throw new Error(`no config in ${name}`);
  return path.join(dir, file);
};

describe('createLiveClassifier', () => {
  it('gives the same verdict as analyze() for every candidate of every fixture', async () => {
    for (const name of ['replaced-scale', 'prefix', 'variants', 'separator', 'count', 'clean']) {
      const config = configOf(name);
      const report = await analyze({
        cwd: fixture(name),
        config,
        unknown: true,
        unknownAll: true,
        suggestions: false,
        maxLocations: 0,
      });
      const live = createLiveClassifier(config);
      for (const g of report.ghosts)
        expect([name, g.class, live.classify(g.class)]).toEqual([name, g.class, 'ghost']);
      for (const u of report.unknownVariant)
        expect([name, u.class, live.classify(u.class)]).toEqual([name, u.class, 'unknown-variant']);
      for (const u of report.unknown)
        expect([name, u.class, live.classify(u.class)]).toEqual([name, u.class, 'unknown']);
      expect(report.summary.ok).toBeGreaterThan(0);
    }
  });

  it('classifies ok classes, carries variants, prefix and separator like the CLI', () => {
    const live = createLiveClassifier(configOf('replaced-scale'));
    expect(live.classify('text-m')).toBe('ok');
    expect(live.classify('md:hover:text-m')).toBe('ok');
    expect(live.classify('text-sm')).toBe('ghost');
    expect(live.classify('md:hover:text-sm')).toBe('ghost');
    expect(live.classify('!p-3')).toBe('ghost');
    expect(live.classify('-m-3')).toBe('ghost');
    expect(live.classify('w-[13px]')).toBe('ok');
    expect(live.classify('swiper-slide')).toBe('unknown');
    expect(live.classify('bogus:text-m')).toBe('unknown-variant');

    const prefixed = createLiveClassifier(configOf('prefix'));
    expect(prefixed.classify('tw-text-sm')).toBe('ghost');
    expect(prefixed.classify('text-sm')).toBe('unknown');

    const sep = createLiveClassifier(configOf('separator'));
    expect(sep.separator).toBe('_');
    expect(sep.classify('md_hover_tw-text-sm')).toBe('ghost');
  });

  it('exposes the stock declarations a ghost would have produced, and memoizes', () => {
    const live = createLiveClassifier(configOf('replaced-scale'));
    expect(live.stockDeclarations('text-sm')).toEqual([
      'font-size: 0.875rem',
      'line-height: 1.25rem',
    ]);
    expect(live.stockDeclarations('text-m')).toEqual([]);
    const first = live.classify('text-sm');
    live.reset();
    expect(live.classify('text-sm')).toBe(first);
  });

  it('fails clearly on an unsupported Tailwind', () => {
    expect(() =>
      createLiveClassifier(path.join(fixture('replaced-scale'), 'nope.config.js')),
    ).toThrow(TwGhostConfigError);
  });
});
