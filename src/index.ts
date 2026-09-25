/**
 * The public entry of `tw-ghost`.
 *
 * Rule: a runtime **value** is exported here iff the README names it; everything else is internal and
 * may change in any release. **Types** are not held to the README — each is reachable from a documented
 * value's signature, and naming all of them in prose would document nothing — but the set is frozen:
 * `test/public-api.test.ts` pins values and types alike (as the type checker sees this module) and
 * checks the values against the README, so a change to either list is a deliberate diff with a
 * changelog line, never an accident of a refactor.
 */
export {
  type AnalyzeOptions,
  analyze,
  type Finding,
  type GhostFinding,
  type Report,
  type Summary,
} from './analyze.js';
export { classify, splitVariants, type Verdict } from './classify.js';
export { describeEnvironment, type EnvReport } from './env.js';
export { TwGhostConfigError } from './errors.js';
export { type Location, scanContent } from './extract.js';
export {
  type ApplyFixMapOptions,
  applyFixMap,
  applyFixMapToText,
  draftFixMap,
  type FixEdit,
  type FixMap,
  type FixMapDraft,
  type FixResult,
  formatFix,
  parseFixMap,
} from './fix.js';
export {
  formatGithub,
  type GithubFormatOptions,
  type GithubFormatResult,
} from './format-github.js';
export {
  formatSarif,
  formatSarifMany,
  type SarifArtifactLocation,
  type SarifFormatOptions,
  type SarifFormatResult,
  type SarifLevel,
  type SarifLocation,
  type SarifLog,
  type SarifMultiformatMessageString,
  type SarifPhysicalLocation,
  type SarifRegion,
  type SarifResult,
  type SarifRule,
  type SarifRun,
  type SarifToolDriver,
} from './format-sarif.js';
export { collectClasses, type StockConfigOptions, stockConfigFrom } from './generate.js';
export {
  detectPackageInfo,
  type FormatInitOptions,
  formatInit,
  type InitFile,
  type InitFileStatus,
  type InitOptions,
  type InitResult,
  init,
  renderWorkflow,
  type WorkflowOptions,
} from './init.js';
export {
  type CreateLiveClassifierOptions,
  createLiveClassifier,
  type LiveClassifier,
} from './live.js';
export {
  type AnalyzeManyOptions,
  analyzeMany,
  type ConfigFailure,
  type ConfigReport,
  type ConfigResult,
  isConfigFailure,
  type MultiReport,
  type MultiSummary,
  type ResolveConfigsOptions,
  resolveConfigPaths,
} from './multi.js';
export {
  assertSupportedTailwind,
  findConfig,
  type LoadProjectOptions,
  loadProject,
} from './project.js';
export { type FormatOptions, formatHuman, formatHumanMany } from './report.js';
export { changedThemeKeys } from './suggest.js';
export { unescapeCssIdentifier } from './unescape.js';
export {
  buildUtilityVocabulary,
  looksUtilityLike,
  type UtilityVocabulary,
  type VocabularyOptions,
} from './vocabulary.js';
