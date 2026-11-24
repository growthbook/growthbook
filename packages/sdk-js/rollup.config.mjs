import babel from "@rollup/plugin-babel";
import resolve from "@rollup/plugin-node-resolve";
import { terser } from "rollup-plugin-terser";
import replace from "@rollup/plugin-replace";
import packageJson from "./package.json" with { type: "json" };

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
      reserved: [
        "_autoExperimentRunner",
        "_evalAutoExperiment",
        "_experimentsDisabled",
        "_hasEventConsumer",
        "_subscribeCustomEvents",
        "_subscribeExperimentViewed",
        "_subscribeFeatureUsage",
      ],
    },
  },
  ecma: 5,
});

// The script bundles served from our CDN as /script/v<major>/<name>.min.js.
// A bundle's name is "core" followed by its features in this (alphabetical)
// order, joined with hyphens.
const SCRIPT_FEATURES = ["redirects", "visual"];
const scriptBundles = SCRIPT_FEATURES.reduce(
  (bundles, feature) => bundles.concat(bundles.map((b) => [...b, feature])),
  [[]],
);

// A build of src/auto-wrapper.ts. `auto` is the legacy auto.min.js, which has
// every feature.
function wrapper({ auto = false, features = [], output }) {
  return {
    input: "src/auto-wrapper.ts",
    external: () => false,
    output,
    plugins: [
      resolve({ extensions, jsnext: true }),
      replace({
        "process.env.NODE_ENV": JSON.stringify("production"),
        preventAssignment: true,
      }),
      replace({
        __SDK_VERSION__: JSON.stringify(version),
        __GB_AUTO__: JSON.stringify(auto),
        ...Object.fromEntries(
          SCRIPT_FEATURES.map((feature) => [
            `__GB_${feature.toUpperCase()}__`,
            JSON.stringify(features.includes(feature)),
          ]),
        ),
        preventAssignment: true,
      }),
      babel({
        babelHelpers: "bundled",
        extensions,
      }),
    ],
  };
}

export default [
  {
    // Not src/index.ts: these keep the pre-3.0 behavior. See src/bundle.ts.
    input: "src/bundle.ts",
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
  wrapper({
    auto: true,
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
  }),
  ...scriptBundles.map((features) =>
    wrapper({
      features,
      output: [
        {
          file: `dist/script/${["core", ...features].join("-")}.min.js`,
          format: "iife",
          name: "_growthbook",
          plugins: [terserSettings],
          sourcemap: true,
        },
      ],
    }),
  ),
];
