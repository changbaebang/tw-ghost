import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import twGhost, { noGhostClass, resetEslintCache } from '../src/eslint.js';
import { fixture } from './helpers.js';

/**
 * Where `npx -y eslint@9` leaves its install. npm's cache is `~/.npm` on POSIX but
 * `%LOCALAPPDATA%\npm-cache` on Windows, so probing only the POSIX path would silently skip
 * every integration case on a Windows runner.
 */
function npxRoots(): string[] {
  const roots = [path.join(homedir(), '.npm', '_npx')];
  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData) roots.push(path.join(localAppData, 'npm-cache', '_npx'));
  const npmCache = process.env.npm_config_cache;
  if (npmCache) roots.push(path.join(npmCache, '_npx'));
  return roots.filter((r) => existsSync(r));
}

/**
 * ESLint is not a dependency of tw-ghost (the plugin ships as `tw-ghost/eslint` with no ESLint
 * import). Tests run the real `Linter` when ESLint 9 is resolvable — from devDependencies or from
 * the npx cache — and skip the integration cases otherwise.
 */
function loadLinter(): (new (opts: { configType: 'flat' }) => LinterLike) | null {
  const req = createRequire(import.meta.url);
  const candidates: string[] = ['eslint'];
  for (const npx of npxRoots()) {
    for (const d of readdirSync(npx)) {
      const p = path.join(npx, d, 'node_modules', 'eslint');
      if (existsSync(path.join(p, 'package.json'))) candidates.push(p);
    }
  }
  for (const c of candidates) {
    try {
      const mod = req(c) as {
        Linter: new (opts: { configType: 'flat' }) => LinterLike;
        ESLint?: { version: string };
      };
      const major = Number.parseInt((req(`${c}/package.json`) as { version: string }).version, 10);
      if (major >= 9) return mod.Linter;
    } catch {}
  }
  return null;
}
interface LinterLike {
  verify(
    code: string,
    config: unknown[],
    options: { filename: string },
  ): { line: number; column: number; endColumn?: number; ruleId: string | null; message: string }[];
}

const Linter = loadLinter();
const project = fixture('replaced-scale');
const file = path.join(project, 'src', 'Lint.jsx');

const lint = (code: string, options: Record<string, unknown> = {}) => {
  if (!Linter) throw new Error('no eslint');
  const linter = new Linter({ configType: 'flat' });
  return linter
    .verify(
      code,
      [
        {
          files: ['**/*.jsx'],
          languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            parserOptions: { ecmaFeatures: { jsx: true } },
          },
          plugins: { 'tw-ghost': twGhost },
          rules: { 'tw-ghost/no-ghost-class': ['error', options] },
        },
      ],
      { filename: file },
    )
    .map((m) => ({
      line: m.line,
      column: m.column,
      end: m.endColumn,
      msg: m.message.slice(0, 60),
    }));
};

describe('tw-ghost/eslint plugin object', () => {
  it('exposes the rule and a flat recommended config', () => {
    expect(Object.keys(twGhost.rules)).toEqual(['no-ghost-class']);
    expect(twGhost.meta.name).toBe('tw-ghost');
    const rec = twGhost.configs.recommended as {
      rules: Record<string, string>;
      plugins: Record<string, unknown>;
    };
    expect(rec.rules['tw-ghost/no-ghost-class']).toBe('error');
    expect(rec.plugins['tw-ghost']).toBe(twGhost);
    expect(noGhostClass.meta.messages.ghost).toContain('{{css}}');
  });
});

describe.skipIf(!Linter)('tw-ghost/no-ghost-class (real ESLint 9 Linter)', () => {
  it('reports ghosts in className, clsx(), template literals and class=, once each, at the token', () => {
    resetEslintCache();
    const out = lint(`import clsx from 'clsx';
export const A = () => <div className="text-sm text-m md:hover:text-sm w-[13px] swiper-slide" />;
export const B = ({ on }) => <p className={clsx('p-4', on && 'p-3', { 'z-10': on }, ['-m-3'])} />;
export const C = () => <span className={\`flex \${1} text-sm\`} />;
export const D = () => <i class="!p-3" />;
`);
    expect(out.map((m) => [m.line, m.column, m.end])).toEqual([
      [2, 40, 47],
      [2, 55, 71],
      [3, 63, 66],
      [3, 72, 76],
      [3, 87, 91],
      [4, 52, 59],
      [5, 34, 38],
    ]);
    expect(out[0]?.msg).toContain('`text-sm` produces no CSS');
    expect(out.every((m) => m.msg.includes('produces no CSS'))).toBe(true);
  });

  it('is silent on ok / arbitrary / unknown classes and on non-class strings', () => {
    expect(
      lint(
        `export const A = () => <div className="text-m p-4 w-[13px] swiper-slide flex" title="text-sm" />;`,
      ),
    ).toEqual([]);
    expect(lint(`const s = 'text-sm'; export const A = () => <div data-x={s} />;`)).toEqual([]);
  });

  it('honours callees, attributes, ignore and the unknown toggles', () => {
    expect(
      lint(`export const A = () => <div className="text-sm" />;`, { ignore: ['^text-'] }),
    ).toEqual([]);
    expect(lint(`export const A = () => <div klass="text-sm" />;`)).toEqual([]);
    expect(
      lint(`export const A = () => <div klass="text-sm" />;`, { attributes: ['klass'] }),
    ).toHaveLength(1);
    expect(lint(`cx('text-sm');`)).toHaveLength(1);
    expect(lint(`myJoin('text-sm');`)).toEqual([]);
    expect(lint(`myJoin('text-sm');`, { callees: ['myJoin'] })).toHaveLength(1);
    expect(lint(`export const A = () => <div className="bogus:text-m" />;`)).toEqual([]);
    expect(
      lint(`export const A = () => <div className="bogus:text-m" />;`, {
        reportUnknownVariant: true,
      }),
    ).toHaveLength(1);
    expect(
      lint(`export const A = () => <div className="swiper-slide" />;`, { reportUnknown: true }),
    ).toHaveLength(1);
  });

  it('reports a single setup diagnostic when no config is found', () => {
    if (!Linter) return;
    const dir = mkdtempSync(path.join(tmpdir(), 'twg-eslint-'));
    // Linter refuses files outside its cwd, so point it at the temp dir.
    const linter = new Linter({ configType: 'flat', cwd: dir } as { configType: 'flat' });
    const out = linter.verify(
      `export const A = () => <div className="text-sm p-3" />;`,
      [
        {
          files: ['**/*.jsx'],
          languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            parserOptions: { ecmaFeatures: { jsx: true } },
          },
          plugins: { 'tw-ghost': twGhost },
          rules: { 'tw-ghost/no-ghost-class': 'error' },
        },
      ],
      // a file under the temp dir: no tailwind.config.* anywhere above it
      { filename: path.join(dir, 'x.jsx') },
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.message).toContain('found no tailwind.config');
  });
});
