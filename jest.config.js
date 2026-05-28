module.exports = {
  preset: 'jest-expo',
  setupFiles: ['<rootDir>/jest.setup.js'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
  testMatch: ['**/__tests__/**/*.test.ts', '**/__tests__/**/*.test.tsx'],
  // Ignore git worktrees so Jest's haste map doesn't see duplicate package.json files.
  modulePathIgnorePatterns: ['<rootDir>/.claude/'],
};
