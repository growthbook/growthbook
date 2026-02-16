module.exports = {
  moduleFileExtensions: ["ts", "js", "node", "json"],
  transform: {
    "^.+\\.(ts|tsx)$": "@swc/jest",
    "shared/.+\\.(ts|tsx|js)$": "@swc/jest",
  },
  transformIgnorePatterns: [
    "node_modules/(?!shared/)",
  ],
  testMatch: ["**/test/**/*.test.(ts|js)"],
  moduleNameMapper: {
    "^axios$": "axios/dist/axios.js",
    "^@typespec/ts-http-runtime/internal/(.*)$":
      "<rootDir>/../../node_modules/.pnpm/@typespec+ts-http-runtime@0.3.1/node_modules/@typespec/ts-http-runtime/dist/commonjs/$1/internal.js",
    // Resolve shared package to src (required when shared uses "type": "module" and ESM .js imports)
    "^shared/types/(.*)$": "<rootDir>/../shared/types/$1",
    "^shared/(.*)$": "<rootDir>/../shared/src/$1",
    "^(\\.\\.?/.*)\\.js$": "$1",
  },
  setupFilesAfterEnv: ["<rootDir>/test/jest.setup.ts"],
};
