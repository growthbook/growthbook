import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "jsdom",
    environmentOptions: { jsdom: { url: "http://localhost/" } },
    ...(process.env.CI ? {} : { maxWorkers: "50%" }),
    sequence: { hooks: "list" },
  },
});
