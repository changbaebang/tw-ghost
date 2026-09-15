export {
  type AnalyzeOptions,
  type Finding,
  type GhostFinding,
  type Report,
  type Summary,
  analyze,
} from './analyze.js';
export {
  CORE_UTILITY_ROOTS,
  DEFAULT_SEPARATOR,
  type Verdict,
  classify,
  collectRoots,
  isPlausibleVariantChain,
  looksUtilityLike,
  splitVariants,
  stripModifiers,
  utilityPart,
  utilityRoot,
} from './classify.js';
export { TwGhostConfigError } from './errors.js';
export { type Location, isWholeToken, scanContent } from './extract.js';
export { type StockConfigOptions, collectClasses, stockConfigFrom } from './generate.js';
export { assertTailwindV3, contentGlobs, findConfig, loadProject } from './project.js';
export { type FormatOptions, formatHuman } from './report.js';
export { changedThemeKeys, flattenThemeKeys } from './suggest.js';
export { unescapeCssIdentifier } from './unescape.js';
