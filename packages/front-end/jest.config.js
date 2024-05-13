module.exports = {
  moduleFileExtensions: ["ts", "js", "tsx", "scss"],
  transform: {
    "^.+\\.(ts|tsx)$": "@swc/jest",
  },
  moduleNameMapper: {
    "\\.scss$": "identity-obj-proxy",
    "@/(.*)": "<rootDir>/$1",
  },
  testMatch: ["**/test/**/*.test.(ts|js)"],
};
