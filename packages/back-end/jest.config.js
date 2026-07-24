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
  // Jest retains each test file's compiled module graph for the worker's
  // lifetime, so a worker's heap grows ~140MB per file and a worker that
  // handles enough files creeps toward the 8GB --max-old-space-size ceiling and
  // crashes with "JavaScript heap out of memory" (intermittently, depending on
  // how files get distributed). Recycle a worker once its RSS passes 2GB so
  // heap usage stays well under the ceiling regardless of file distribution.
  workerIdleMemoryLimit: "2GB",
};
