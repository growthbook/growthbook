module.exports = {
  moduleFileExtensions: ["ts", "js", "node", "json"],
  transform: {
    "^.+\\.(ts|tsx|js|mjs)$": "@swc/jest",
  },
  // uuid@14+ ships ESM-only. Let swc transpile it for the Jest CJS runtime.
  transformIgnorePatterns: ["node_modules/(?!\\.pnpm/uuid@|uuid/)"],
  testMatch: ["**/test/**/*.test.(ts|js)"],
  moduleNameMapper: {
    "^axios$": "axios/dist/axios.js",
    "^@typespec/ts-http-runtime/internal/(.*)$":
      "<rootDir>/../../node_modules/.pnpm/@typespec+ts-http-runtime@0.3.1/node_modules/@typespec/ts-http-runtime/dist/commonjs/$1/internal.js",
  },
  setupFilesAfterEnv: ["<rootDir>/test/jest.setup.ts"],
  // Cap parallelism only where a `pnpm dev` stack competes for the same box
  // (local laptop or cloud dev agent). CI has a dedicated runner and runs the
  // workspaces sequentially, so it keeps Jest's default worker count. Jest
  // retains each file's module graph for the worker's lifetime (~140MB/file),
  // so the idle-memory recycle keeps a long-lived worker from creeping toward
  // the heap ceiling and OOMing.
  ...(process.env.CI ? {} : { maxWorkers: 2 }),
  workerIdleMemoryLimit: "768MB",
};
