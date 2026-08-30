module.exports = {
  moduleFileExtensions: ["ts", "js"],
  transform: {
    "^.+\\.(ts|tsx)$": "@swc/jest",
  },
  testMatch: ["**/test/**/*.test.(ts|js)"],
  // Pinned rather than left in the OS temp dir so CI can cache it between runs.
  cacheDirectory: "<rootDir>/.jest-cache",
};
