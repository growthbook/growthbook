import path from "path";
import { defineConfig } from "vite";

export default defineConfig({
  test: {
    globals: true,
    // Most specs here test pure functions. Building a jsdom for all of them cost
    // ~20s a run, so files that need a DOM opt in with a
    // `// @vitest-environment jsdom` docblock instead.
    environment: "node",
    setupFiles: ["./test/setup.ts"],
    // Off CI, tests share the box with a running `pnpm dev` stack, so cap
    // workers.
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
