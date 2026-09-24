/**
 * Path plumbing that differs between POSIX and Windows.
 *
 * Three rules hold everywhere in tw-ghost:
 *
 * 1. Anything that reaches the user (report locations, `--format github` annotations, the
 *    `== config` headers) is POSIX — `toPosix`, so output and CI annotations are identical on
 *    every platform.
 * 2. Anything handed to tinyglobby is a POSIX *pattern* — `toGlobPattern`. picomatch reads `\`
 *    as an escape, never as a separator.
 * 3. Anything read off disk may carry a UTF-8 BOM — `stripBom` / `splitBom`. Windows editors
 *    (Visual Studio, Notepad, `Set-Content` on PowerShell 5.1) write one by default.
 */
import path from 'node:path';

const isWindows = process.platform === 'win32';

/** Byte-order mark as it arrives from `readFile(…, 'utf8')`. */
export const BOM = '\uFEFF';

/** A path with forward slashes, for output and for comparing against other POSIX paths. */
export const toPosix = (p: string): string => p.split(path.sep).join('/');

/**
 * Does a POSIX-normalized *relative* path leave the directory it is relative to? Compared by
 * segment: `..` and `../x` climb; `..shared/x` is a directory whose name happens to start with two
 * dots and stays inside. A `startsWith('..')` test conflates the two.
 */
export const climbsOut = (posixRel: string): boolean =>
  posixRel === '..' || posixRel.startsWith('../');

/**
 * A glob pattern tinyglobby can actually use.
 *
 * Glob patterns are POSIX: tinyglobby (picomatch) reads `\` as an escape character, never as a
 * path separator, so a Windows-shaped pattern silently matches nothing — `src\**\*.tsx` from a
 * shell, or `.\\src\\**\\*.tsx` from a `content` array written on Windows. On win32 the
 * separators are rewritten; on POSIX the pattern is returned untouched, because there a `\` is a
 * deliberate escape the caller may have meant (`text-\\[50%\\]`).
 */
export const toGlobPattern = (pattern: string): string =>
  isWindows ? pattern.replace(/\\/g, '/') : pattern;

/** File text without a leading BOM, so line 1 columns match what an editor shows. */
export const stripBom = (text: string): string => (text.startsWith(BOM) ? text.slice(1) : text);

/** `[bom, rest]` — keep the BOM aside while rewriting text, then put it back byte-for-byte. */
export const splitBom = (text: string): [string, string] =>
  text.startsWith(BOM) ? [BOM, text.slice(1)] : ['', text];
