import * as esbuild from "esbuild";

const rawOptions = {
  entryPoints: ["src/index.ts"],
  sourcemap: true,
  bundle: true,
  packages: "external",
  define: {
    "process.env.NODE_ENV": '"production"',
  },
};

await Promise.all([
  esbuild.build({
    ...rawOptions,
    format: "esm",
    outdir: "dist/esm",
    outExtension: { ".js": ".mjs" },
  }),
  esbuild.build({
    ...rawOptions,
    format: "cjs",
    outdir: "dist/cjs",
  }),
]);
