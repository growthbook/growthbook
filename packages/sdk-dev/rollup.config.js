import babel from "@rollup/plugin-babel";
import resolve from "@rollup/plugin-node-resolve";
import replace from "@rollup/plugin-replace";
import commonjs from "@rollup/plugin-commonjs";
import { terser } from "rollup-plugin-terser";

const extensions = [".js", ".ts", ".tsx", ".jsx"];

const plugins = [
  resolve({ extensions, jsnext: true }),
  commonjs(),
  replace({
    "process.env.NODE_ENV": JSON.stringify("production"),
    preventAssignment: true,
  }),
  babel({
    babelHelpers: "bundled",
    extensions,
  }),
];

const outro = `autoload()`;

export default {
  input: "src/index.tsx",
  output: [
    {
      file: "dist/bundles/index.js",
      format: "iife",
      name: "growthbook",
      outro,
      sourcemap: true,
    },
    {
      file: "dist/bundles/index.min.js",
      format: "iife",
      name: "growthbook",
      outro,
      sourcemap: true,
      plugins: [
        terser({
          output: { comments: false },
          compress: {
            keep_infinity: true,
            pure_getters: true,
            passes: 10,
          },
          ecma: 5,
        }),
      ],
    },
  ],
  plugins,
};
