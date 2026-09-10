import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Resolve workspace entrypoints to source so module mocks reach their imports.
  resolve: {
    alias: [
      {
        find: /^shared(?:\/(.*))?$/,
        replacement: `${path.resolve(__dirname, "../shared/src")}/$1`,
      },
      {
        find: /^stats-ts(?:\/(.*))?$/,
        replacement: `${path.resolve(__dirname, "src")}/$1`,
      },
    ],
  },
  test: {
    globals: true,
    hookTimeout: 5000,
    environment: "node",
    include: ["**/test/**/*.test.{ts,js}"],
    pool: "forks",
    isolate: true,
    ...(process.env.CI ? {} : { maxWorkers: "50%" }),
    sequence: { hooks: "list" },
  },
});
