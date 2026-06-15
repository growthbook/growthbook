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
  // Many tests spin up an in-memory mongod per worker. On CI's 16GB runner,
  // unbounded workers + the 8GB heap ceiling exhaust RAM and the runner gets
  // OOM-killed (SIGTERM / "lost communication"). Cap workers on CI and recycle
  // any worker whose RSS balloons so peak memory stays bounded.
  maxWorkers: process.env.CI ? 2 : "50%",
  workerIdleMemoryLimit: "2GB",
};
