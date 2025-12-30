import path from "path";
import { defineConfig } from "vite";

export default defineConfig({
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    coverage: {
      provider: "v8",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
    },
  },
  esbuild: {
    jsx: "automatic",
  },
});
