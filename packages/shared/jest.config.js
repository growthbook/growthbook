module.exports = {
  moduleFileExtensions: ["ts", "js"],
  transform: {
    "^.+\\.(ts|tsx)$": "@swc/jest",
  },
  testMatch: ["**/test/**/*.test.(ts|js)"],
  // Test against the workspace SDK source (not the published tarball) so config
  // invariants exercise the local mongrule + `$ref` changes.
  moduleNameMapper: {
    "^@growthbook/growthbook$": "<rootDir>/../sdk-js/src/index.ts",
  },
};
