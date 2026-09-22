import pkg from '../package.json';

/** The package version, inlined by tsup into both the ESM and CJS builds. */
export const VERSION: string = pkg.version;
