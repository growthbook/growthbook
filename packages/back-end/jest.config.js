module.exports = {
  globals: {
    "ts-jest": {
      tsconfig: "./tsconfig.spec.json",
    },
  },
  moduleFileExtensions: ["ts", "js"],
  transform: {
    "^.+\\.(ts|tsx)$": "ts-jest",
  },
  testMatch: ["**/test/**/*.test.(ts|js)"],
};
