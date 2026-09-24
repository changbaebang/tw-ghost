import { describe, expect, it } from 'vitest';
import * as api from '../src/index.js';

// The runtime surface of `tw-ghost`, pinned. Rule (src/index.ts): exported iff the README documents
// it. Adding a symbol: document it, add it here, log it. Removing one: that is a major, and this
// failure is the reminder. Types are not visible at runtime and are pinned by `tsc` instead.
const DOCUMENTED = [
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

describe('public API surface', () => {
  it('exports exactly the documented runtime symbols', () => {
    expect(Object.keys(api).sort()).toEqual([...DOCUMENTED].sort());
  });
});
