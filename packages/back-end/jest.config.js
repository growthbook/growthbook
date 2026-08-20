module.exports = {
  moduleFileExtensions: ["ts", "js", "node", "json"],
  transform: {
    "^.+\\.(ts|tsx)$": "@swc/jest",
    "^.+\\.(js|mjs)$": "<rootDir>/test/jest-strip-import-attrs.cjs",
  },
  // uuid@14+ and agenda@6 ship ESM-only. Let swc transpile them for Jest CJS.
  transformIgnorePatterns: [
    "node_modules/(?!\\.pnpm/(uuid@|agenda@|agenda-mongo@|@agendajs\\+)|uuid/|agenda/|agenda-mongo/|@agendajs/)",
  ],
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
