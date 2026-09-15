/**
 * Error thrown for usage / configuration problems. The CLI maps it to exit code 2.
 */
export class TwGhostConfigError extends Error {
  override readonly name = 'TwGhostConfigError';
}
