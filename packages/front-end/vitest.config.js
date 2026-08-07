import path from "path";
import { defineConfig } from "vite";

export default defineConfig({
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    // Cap parallelism only where a `pnpm dev` stack competes for the same box
    // (local laptop or cloud dev agent). CI has a dedicated runner, so it keeps
    // Vitest's default worker count.
    ...(process.env.CI ? {} : { maxWorkers: 2 }),
    coverage: {
      provider: "v8",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
    },
    dedupe: ["react", "react-dom"],
  },
  esbuild: {
    jsx: "automatic",
  },
});
