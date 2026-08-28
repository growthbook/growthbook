// Packages no test exercises, stubbed to keep their init cost out of 300+ fresh
// module registries. The googleapis barrel alone eagerly requires 472 modules.
const STUBBED_DRIVERS = [
  "googleapis",
  "@sentry/node",
  "stripe",
  "openid-client",
  "jwks-rsa",
  "ai",
  "openai",
  "@ai-sdk/anthropic",
  "@ai-sdk/google",
  "@ai-sdk/mistral",
  "@ai-sdk/openai",
  "@ai-sdk/xai",
  "@dqbd/tiktoken",
  "tiktoken",
  "proxy-agent",
  "kerberos",
  "@google-cloud/bigquery",
  "@google-cloud/storage",
  "@aws-sdk/client-athena",
  "@aws-sdk/client-sts",
  "@aws-sdk/client-s3",
  "@aws-sdk/client-cloudwatch",
  "@aws-sdk/credential-providers",
  "@aws-sdk/s3-request-presigner",
  "@aws-sdk/s3-presigned-post",
  "@databricks/sql",
  "@clickhouse/client",
  "presto-client",
  "mysql2",
  "mysql2/promise",
  "mssql",
];

const driverStubs = Object.fromEntries(
  STUBBED_DRIVERS.map((m) => [
    `^${m}$`,
    "<rootDir>/test/stubs/heavy-module.js",
  ]),
);

module.exports = {
  moduleFileExtensions: ["ts", "js", "node", "json"],
  transform: {
    "^.+\\.(ts|tsx|js|mjs)$": "@swc/jest",
  },
  // uuid@14+ ships ESM-only. Let swc transpile it for the Jest CJS runtime.
  transformIgnorePatterns: ["node_modules/(?!\\.pnpm/uuid@|uuid/)"],
  testMatch: ["**/test/**/*.test.(ts|js)"],
  // Pinned rather than left in the OS temp dir so CI can cache it between runs.
  cacheDirectory: "<rootDir>/.jest-cache",
  moduleNameMapper: {
    ...driverStubs,
    "^axios$": "axios/dist/axios.js",
    "^@typespec/ts-http-runtime/internal/(.*)$":
      "<rootDir>/../../node_modules/.pnpm/@typespec+ts-http-runtime@0.3.1/node_modules/@typespec/ts-http-runtime/dist/commonjs/$1/internal.js",
  },
  globalSetup: "<rootDir>/test/globalSetup.ts",
  globalTeardown: "<rootDir>/test/globalTeardown.ts",
  setupFilesAfterEnv: ["<rootDir>/test/jest.setup.ts"],
  // For non-CI, lets make sure to cap the workers
  ...(process.env.CI ? {} : { maxWorkers: "50%" }),
  // Recycle workers before the heap fills; 1GB cost more in restarts than it saved.
  workerIdleMemoryLimit: "2GB",
};
