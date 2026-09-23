export {
  type AnalyzeOptions,
  analyze,
  type Finding,
  type GhostFinding,
  type Report,
  type Summary,
} from './analyze.js';
export {
  CORE_UTILITY_ROOTS,
  classify,
  collectRoots,
  DEFAULT_SEPARATOR,
  isPlausibleVariantChain,
  splitVariants,
  stripModifiers,
  utilityPart,
  utilityRoot,
  type Verdict,
} from './classify.js';
export { describeEnvironment, describeProject, type EnvReport, formatEnv } from './env.js';
export { TwGhostConfigError } from './errors.js';
export { isWholeToken, type Location, scanContent } from './extract.js';
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
  replacementFor,
} from './fix.js';
export {
  DEFAULT_MAX_ANNOTATIONS,
  formatGithub,
  type GithubFormatOptions,
  type GithubFormatResult,
} from './format-github.js';
export {
  automationIdFor,
  classFingerprint,
  encodeUriPath,
  formatSarif,
  formatSarifMany,
  GHOST_RULE_ID,
  SARIF_FINGERPRINT_KEY,
  SARIF_MAX_SUGGESTIONS,
  SARIF_SCHEMA_URI,
  SARIF_TOOL_NAME,
  SARIF_URI_BASE_ID,
  SARIF_VERSION,
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
  sarifRules,
  UNKNOWN_UTILITY_RULE_ID,
  UNKNOWN_VARIANT_RULE_ID,
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
  ALL_CONFIGS_IGNORE_DIRS,
  type AnalyzeManyOptions,
  analyzeMany,
  type ConfigFailure,
  type ConfigReport,
  type ConfigResult,
  configLabel,
  isConfigFailure,
  isMultiConfigRequest,
  type MultiReport,
  type MultiSummary,
  type ResolveConfigsOptions,
  resolveConfigPaths,
} from './multi.js';
export {
  assertSupportedTailwind,
  assertTailwindV3,
  COMPATIBILITY_DOCS,
  contentGlobs,
  contentWarnings,
  findConfig,
  type LoadProjectOptions,
  loadProject,
  MIN_TAILWIND_VERSION,
  SUPPORTED_TAILWIND_RANGE,
  unwrapDefaultExport,
} from './project.js';
export { type FormatOptions, formatHuman, formatHumanMany } from './report.js';
export { changedThemeKeys, flattenThemeKeys } from './suggest.js';
export { unescapeCssIdentifier } from './unescape.js';
export {
  buildUtilityVocabulary,
  looksUtilityLike,
  matchUtilityPrefix,
  type UtilityVocabulary,
  type VocabularyOptions,
  withinOneEdit,
} from './vocabulary.js';
