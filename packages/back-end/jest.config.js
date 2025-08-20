module.exports = {
  moduleFileExtensions: ["ts", "js", "node", "json"],
  transform: {
    "^.+\\.(ts|tsx)$": "@swc/jest",
  },
  testMatch: ["**/test/**/*.test.(ts|js)"],
  moduleNameMapper: {
    "^axios$": "axios/dist/axios.js",
  },
  setupFilesAfterEnv: ["<rootDir>/test/jest.setup.ts"],
};
