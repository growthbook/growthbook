import { createRequire } from "module";
import * as esbuild from "esbuild";

const require = createRequire(import.meta.url);
const { version } = require("./package.json");

const bundleOptions = {
  sourcemap: true,
  define: {
    "process.env.NODE_ENV": '"production"',
    __SDK_VERSION__: JSON.stringify(version),
  },
  bundle: true,
};

const rawOptions = {
  sourcemap: true,
  define: {
    __SDK_VERSION__: JSON.stringify(version),
  },
  entryPoints: ["src/**/*.ts"],
};

const minifyOptions = {
  minify: true,
  mangleProps: /^_/,
};

const autoWrapperOptions = {
  ...bundleOptions,
  entryPoints: ["src/auto-wrapper.ts"],
  globalName: "_growthbook",
  format: "iife",
};

const esmBundleOptions = {
  ...bundleOptions,
  entryPoints: ["src/index.ts"],
  format: "esm",
};

const indexBundleOptions = {
  ...bundleOptions,
  entryPoints: ["src/index.ts"],
  globalName: "growthbook",
  format: "iife",
};

await Promise.all([
  esbuild.build({
    ...autoWrapperOptions,
    outfile: "dist/bundles/auto.js",
  }),
  esbuild.build({
    ...autoWrapperOptions,
    ...minifyOptions,
    outfile: "dist/bundles/auto.min.js",
  }),
  esbuild.build({
    ...esmBundleOptions,
    outfile: "dist/bundles/esm.js",
  }),
  esbuild.build({
    ...esmBundleOptions,
    ...minifyOptions,
    outfile: "dist/bundles/esm.min.js",
  }),
  esbuild.build({
    ...indexBundleOptions,
    outfile: "dist/bundles/index.js",
  }),
  esbuild.build({
    ...indexBundleOptions,
    ...minifyOptions,
    outfile: "dist/bundles/index.min.js",
  }),
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
