import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Resolve workspace entrypoints to source so module mocks reach their imports.
  resolve: {
    alias: [
      { find: /^back-end\//, replacement: `${path.resolve(__dirname)}/` },
      {
        find: /^shared(?:\/(.*))?$/,
        replacement: `${path.resolve(__dirname, "../shared/src")}/$1`,
      },
      {
        find: /^stats-ts(?:\/(.*))?$/,
        replacement: `${path.resolve(__dirname, "../stats-ts/src")}/$1`,
      },
    ],
  },
  test: {
    globals: true,
    // Keep parameterized snapshot names distinct instead of truncating long IDs.
    chaiConfig: { truncateThreshold: 0 },
    environment: "node",
    include: ["**/test/**/*.test.{ts,js}"],
    setupFiles: ["./test/setup.ts"],
    ...(process.env.CI ? {} : { maxWorkers: "50%" }),
    sequence: { hooks: "list" },
  },
});
