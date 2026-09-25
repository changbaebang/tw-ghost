import { defaultExclude, defineConfig } from 'vitest/config';

// The tests that either spawn `dist/cli.js` or load a real Tailwind config once per fixture. Six
// spawns in the --fix-map round trip cost ~1.7 s on Linux/macOS and ~5 s on a windows-latest
// runner, which overruns vitest's 5 s default; `createLiveClassifier` loads six configs in-process
// and is the same shape of slow. Splitting the round trip into pieces would stop testing the round
// trip, so the ceiling is raised — but only here.
const integration = [
  'test/cli.test.ts',
  'test/preflight.test.ts',
  'test/live.test.ts',
  'test/public-api.test.ts', // builds a TypeScript program of src/index.ts
];

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['test/**/*.test.ts'],
          exclude: [...defaultExclude, ...integration],
          // No timeout override: a unit test or hook that deadlocks must surface at vitest's
          // default (5 s / 10 s), not 60 s later.
        },
      },
      {
        test: {
          name: 'integration',
          include: integration,
          // ~6x the slowest measured windows-latest case, and bounded — unlike the global 60 s this
          // replaces. hookTimeout stays at the default: these suites do their setup inside the test.
          testTimeout: 30_000,
        },
      },
    ],
  },
});
