import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';
import * as api from '../src/index.js';
import { ROOT } from './helpers.js';

// The public surface of `tw-ghost`, pinned — values and types, as TypeScript sees src/index.ts.
// Rule (src/index.ts): a symbol is exported iff the README names it. Adding one: document it, add
// it here, log it. Removing one: that is a major, and this failure is the reminder.
const VALUES = [
  'TwGhostConfigError',
  'analyze',
  'analyzeMany',
  'applyFixMap',
  'applyFixMapToText',
  'assertSupportedTailwind',
  'buildUtilityVocabulary',
  'changedThemeKeys',
  'classify',
  'collectClasses',
  'createLiveClassifier',
  'describeEnvironment',
  'detectPackageInfo',
  'draftFixMap',
  'findConfig',
  'formatFix',
  'formatGithub',
  'formatHuman',
  'formatHumanMany',
  'formatInit',
  'formatSarif',
  'formatSarifMany',
  'init',
  'isConfigFailure',
  'loadProject',
  'looksUtilityLike',
  'parseFixMap',
  'renderWorkflow',
  'resolveConfigPaths',
  'scanContent',
  'splitVariants',
  'stockConfigFrom',
  'unescapeCssIdentifier',
];

const TYPES = [
  'AnalyzeManyOptions',
  'AnalyzeOptions',
  'ApplyFixMapOptions',
  'ConfigFailure',
  'ConfigReport',
  'ConfigResult',
  'CreateLiveClassifierOptions',
  'EnvReport',
  'Finding',
  'FixEdit',
  'FixMap',
  'FixMapDraft',
  'FixResult',
  'FormatInitOptions',
  'FormatOptions',
  'GhostFinding',
  'GithubFormatOptions',
  'GithubFormatResult',
  'InitFile',
  'InitFileStatus',
  'InitOptions',
  'InitResult',
  'LiveClassifier',
  'LoadProjectOptions',
  'Location',
  'MultiReport',
  'MultiSummary',
  'Report',
  'ResolveConfigsOptions',
  'SarifArtifactLocation',
  'SarifFormatOptions',
  'SarifFormatResult',
  'SarifLevel',
  'SarifLocation',
  'SarifLog',
  'SarifMultiformatMessageString',
  'SarifPhysicalLocation',
  'SarifRegion',
  'SarifResult',
  'SarifRule',
  'SarifRun',
  'SarifToolDriver',
  'StockConfigOptions',
  'Summary',
  'UtilityVocabulary',
  'Verdict',
  'VocabularyOptions',
  'WorkflowOptions',
];

/** Every export of src/index.ts, split by whether it exists at runtime, through the type checker. */
function surfaceOfIndex(): { values: string[]; types: string[] } {
  const tsconfig = ts.readConfigFile(path.join(ROOT, 'tsconfig.json'), ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(tsconfig.config, ts.sys, ROOT);
  const entry = path.join(ROOT, 'src/index.ts');
  const program = ts.createProgram([entry], { ...parsed.options, noEmit: true });
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(entry);
  if (!source) throw new Error('src/index.ts not in program');
  const module = checker.getSymbolAtLocation(source);
  if (!module) throw new Error('src/index.ts has no module symbol');
  const values: string[] = [];
  const types: string[] = [];
  for (const symbol of checker.getExportsOfModule(module)) {
    const target = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
    (target.flags & ts.SymbolFlags.Value ? values : types).push(symbol.name);
  }
  return { values: values.sort(), types: types.sort() };
}

describe('public API surface', () => {
  it('exports exactly the pinned values at runtime', () => {
    expect(Object.keys(api).sort()).toEqual([...VALUES].sort());
  });

  // `tsc --noEmit` only proves the declarations compile; dropping an unused `type X` export from
  // index.ts would still typecheck. The checker's view of the module is the set that matters.
  it('exports exactly the pinned values and types, as TypeScript sees src/index.ts', () => {
    const surface = surfaceOfIndex();
    expect(surface.values).toEqual([...VALUES].sort());
    expect(surface.types).toEqual([...TYPES].sort());
  });

  // The rule is "exported iff documented", so the list is checked against the README, not only
  // against itself. Identifiers appear in prose (`name`) and in code blocks (name), hence the
  // word-boundary match rather than a backtick one.
  it('names every exported value in README.md', () => {
    const readme = readFileSync(path.join(ROOT, 'README.md'), 'utf8');
    const named = (name: string): boolean =>
      new RegExp(`(^|[^A-Za-z0-9_])${name}(?![A-Za-z0-9_])`).test(readme);
    expect(VALUES.filter((name) => !named(name))).toEqual([]);
  });
});
