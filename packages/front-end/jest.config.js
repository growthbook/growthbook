module.exports = {
  moduleFileExtensions: ["ts", "js", "tsx", "scss"],
  transform: {
    "^.+\\.(ts|tsx)$": "@swc/jest",
  },
  moduleNameMapper: {
    "\\.scss$": "identity-obj-proxy",
  },
  testMatch: ["**/test/**/*.test.(ts|js)"],
};
