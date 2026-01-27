module.exports = {
  testEnvironment: "node",
  transform: {
    "^.+\\.tsx?$": "@swc/jest",
  },
  testMatch: ["**/test/**/*.test.ts"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json"],
};
