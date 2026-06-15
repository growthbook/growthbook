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
  // A worker occasionally leaks heap across files (esp. the heavier
  // eventForwarder suites), creeping toward the 8GB --max-old-space-size
  // ceiling and crashing the run with "JavaScript heap out of memory".
  // Recycle a worker once its RSS passes 4GB so it resets well before the heap
  // limit. The threshold sits above the normal ~2GB working set, so healthy
  // workers are never restarted (a lower limit thrashes and stalls CI).
  workerIdleMemoryLimit: "4GB",
};
