import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    hookTimeout: 5000,
    environment: "jsdom",
    environmentOptions: { jsdom: { url: "http://localhost/" } },
    include: [
      "**/__tests__/**/*.{ts,tsx,js,jsx}",
      "**/*.{test,spec}.{ts,tsx,js,jsx}",
    ],
    pool: "forks",
    isolate: true,
    ...(process.env.CI ? {} : { maxWorkers: "50%" }),
    sequence: { hooks: "list" },
  },
});
