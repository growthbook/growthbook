import path from "path";
import { defineConfig } from "vite";

export default defineConfig({
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    // Threads start faster than the default forks pool; ~15% off the suite.
    pool: "threads",
    // Off CI, tests share the box with a running `pnpm dev` stack, so leave it
    // half the cores. CI sets its own worker count from the runner size.
    ...(process.env.CI ? {} : { maxWorkers: "50%" }),
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
