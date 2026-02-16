module.exports = {
  moduleFileExtensions: ["ts", "js"],
  transform: {
    "^.+\\.(ts|tsx)$": "@swc/jest",
  },
  testMatch: ["**/test/**/*.test.(ts|js)"],
  moduleNameMapper: {
    // Tests use ../permissions which would hit root ESM stub; redirect to src
    "^\\.\\./permissions$": "<rootDir>/src/permissions",
    // src/** imports like ../../experiments.js resolve to root ESM stubs; redirect to src
    "^\\.\\./(\\.\\./)?(experiments|constants|dates|enterprise|health|validators)(\\.js)?$":
      "<rootDir>/src/$2",
    // shared/types/* are at package root, not in src/
    "^shared/types/(.*)$": "<rootDir>/types/$1",
    // Resolve other shared/* to src/* so we use TS source instead of ESM dist/ stubs
    "^shared/(.*)$": "<rootDir>/src/$1",
    // Strip .js from relative imports so they resolve to .ts source
    "^(\\.\\.?/.*)\\.js$": "$1",
  },
};
