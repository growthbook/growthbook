import babel from "@rollup/plugin-babel";
import resolve from "@rollup/plugin-node-resolve";
import { terser } from "rollup-plugin-terser";
import replace from "@rollup/plugin-replace";
import packageJson from "./package.json" assert { type: "json" };

const { version } = packageJson;

const extensions = [".js", ".ts"];

const terserSettings = terser({
  output: { comments: false },
  compress: {
    keep_infinity: true,
    pure_getters: true,
    passes: 10,
  },
  mangle: {
    properties: {
      regex: /^_/,
    },
  },
  ecma: 5,
});

export default [
  {
    input: "src/index.ts",
    external: () => false,
    output: [
      {
        file: "dist/bundles/esm.js",
        format: "esm",
        sourcemap: true,
      },
      {
        file: "dist/bundles/esm.min.js",
        format: "esm",
        plugins: [terserSettings],
        sourcemap: true,
      },
      {
        file: "dist/bundles/index.js",
        format: "iife",
        name: "growthbook",
        sourcemap: true,
      },
      {
        file: "dist/bundles/index.min.js",
        format: "iife",
        name: "growthbook",
        plugins: [terserSettings],
        sourcemap: true,
      },
    ],
    plugins: [
      resolve({ extensions, jsnext: true }),
      replace({
        "process.env.NODE_ENV": JSON.stringify("production"),
        preventAssignment: true,
      }),
      babel({
        babelHelpers: "bundled",
        extensions,
      }),
    ],
  },
  {
    input: "src/auto-wrapper.ts",
    external: () => false,
    output: [
      {
        file: "dist/bundles/auto.js",
        format: "iife",
        name: "_growthbook",
        sourcemap: true,
      },
      {
        file: "dist/bundles/auto.min.js",
        format: "iife",
        name: "_growthbook",
        plugins: [terserSettings],
        sourcemap: true,
      },
    ],
    plugins: [
      resolve({ extensions, jsnext: true }),
      replace({
        "process.env.NODE_ENV": JSON.stringify("production"),
        preventAssignment: true,
      }),
      replace({
        __SDK_VERSION__: JSON.stringify(version),
        preventAssignment: true,
      }),
      babel({
        babelHelpers: "bundled",
        extensions,
      }),
    ],
  },
];

