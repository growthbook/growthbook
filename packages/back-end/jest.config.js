module.exports = {
  moduleFileExtensions: ["ts", "js", "node"],
  transform: {
    "^.+\\.(ts|tsx)$": [
      "ts-jest",
      {
        diagnostics: false,
      },
    ],
  },
  testMatch: ["**/test/**/*.test.(ts|js)"],
};
