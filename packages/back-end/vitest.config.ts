import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["**/test/**/*.test.(ts|js)"],
    setupFiles: [],
    alias: {
      "back-end": path.resolve(__dirname, "./"),
    },
    testTimeout: 10000,
  },
  resolve: {
    alias: {
      "^axios$": "axios/dist/axios.js",
    },
  },
});
