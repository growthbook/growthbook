module.exports = {
  moduleFileExtensions: ["ts", "js", "node"],
  transform: {
    "^.+\\.(ts|tsx)$": "@swc/jest",
  },
  testMatch: ["**/test/**/*.test.(ts|js)"],
};
