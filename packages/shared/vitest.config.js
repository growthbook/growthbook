import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Resolve workspace entrypoints to source so module mocks reach their imports.
  resolve: {
    alias: [
      {
        find: /^shared(?:\/(.*))?$/,
        replacement: `${path.resolve(__dirname, "src")}/$1`,
      },
    ],
  },
  test: {
    globals: true,
    environment: "node",
    include: ["**/test/**/*.test.{ts,js}"],
    ...(process.env.CI ? {} : { maxWorkers: "50%" }),
    sequence: { hooks: "list" },
  },
});
