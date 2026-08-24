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
  // For non-CI, lets make sure to cap the workers
  ...(process.env.CI ? {} : { maxWorkers: "50%" }),
  // Each file's module graph stays resident (~140MB/file); recycle workers
  // before the heap fills.
  workerIdleMemoryLimit: process.env.CI ? "2GB" : "1GB",
};
