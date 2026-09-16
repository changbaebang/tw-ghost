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
export { TwGhostConfigError } from './errors.js';
export { isWholeToken, type Location, scanContent } from './extract.js';
export { collectClasses, type StockConfigOptions, stockConfigFrom } from './generate.js';
export { assertTailwindV3, contentGlobs, findConfig, loadProject } from './project.js';
export { type FormatOptions, formatHuman } from './report.js';
export { changedThemeKeys, flattenThemeKeys } from './suggest.js';
export { unescapeCssIdentifier } from './unescape.js';
