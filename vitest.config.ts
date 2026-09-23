import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The CLI tests spawn `dist/cli.js` and load the project's Tailwind once per run — six spawns
    // in the --fix-map round trip. That is ~1.5 s on Linux and ~5 s on a windows-latest runner,
    // which overruns vitest's 5 s default. Raise the ceiling instead of splitting the round trip
    // into pieces that would no longer test the round trip.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
