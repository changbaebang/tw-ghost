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
  looksUtilityLike,
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

export { collectClasses, type StockConfigOptions, stockConfigFrom } from './generate.js';
export {
  ALL_CONFIGS_IGNORE_DIRS,
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
