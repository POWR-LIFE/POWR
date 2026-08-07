const expoPreset = require('jest-expo/jest-preset');

// jest-expo compiles with Metro's babel caller, which leaves `import()` as a
// native dynamic import — unsupported inside Jest's VM without
// --experimental-vm-modules, so every `await import(...)` throws at runtime.
// GeofenceContext lazy-imports lib/device and lib/notifications on the claim and
// check-in paths, so those branches were untestable (they failed silently into
// their catch blocks). Compiling dynamic imports to require() for tests only
// keeps Metro/EAS bundling completely untouched.
const SOURCE_TRANSFORM = '\\.[jt]sx?$';
const [sourceTransformer, sourceOptions] = expoPreset.transform[SOURCE_TRANSFORM];

module.exports = {
  preset: 'jest-expo',
  setupFiles: ['<rootDir>/jest.setup.js'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
  testMatch: ['**/__tests__/**/*.test.ts', '**/__tests__/**/*.test.tsx'],
  // Jest's 5s default is a wall-clock budget, and these suites share 11 workers
  // on a machine that is also running everything else. A render test that takes
  // 300ms alone can exceed 5s purely by being starved of CPU — which reads as a
  // real failure and has repeatedly been triaged as one. Verified by running the
  // suite oversubscribed (24 workers + 12 busy cores): at 5s, unrelated suites
  // fail the timeout; at 15s they pass, and the timings are otherwise unchanged.
  // Still well under any genuine hang — a deadlocked test fails in 15s, not 5.
  testTimeout: 15_000,
  // Ignore git worktrees so Jest's haste map doesn't see duplicate package.json files.
  modulePathIgnorePatterns: ['<rootDir>/.claude/'],
  transform: {
    ...expoPreset.transform,
    [SOURCE_TRANSFORM]: [
      sourceTransformer,
      { ...sourceOptions, plugins: ['babel-plugin-dynamic-import-node'] },
    ],
  },
};
