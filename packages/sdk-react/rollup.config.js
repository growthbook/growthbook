import babel from "@rollup/plugin-babel";
import resolve from "@rollup/plugin-node-resolve";
import replace from "@rollup/plugin-replace";
import commonjs from "@rollup/plugin-commonjs";
import dts from "rollup-plugin-dts";

const extensions = [".js", ".ts", ".tsx", ".jsx"];

export default [
  {
    input: "src/client/index.ts",
    external: (id) => {
      return !id.match(/(sdk-react|^\.)/);
    },
    output: [
      {
        dir: "dist/client/esm",
        format: "esm",
        sourcemap: true,
      },
      {
        dir: "dist/client/cjs",
        format: "cjs",
        name: "growthbook",
        sourcemap: true,
      },
    ],
    plugins: [
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
    ],
  },
  {
    input: "src/server/index.ts",
    external: (id) => {
      return !id.match(/(sdk-react|^\.)/);
    },
    output: [
      {
        dir: "dist/server/esm",
        format: "esm",
        sourcemap: true,
      },
      {
        dir: "dist/server/cjs",
        format: "cjs",
        name: "growthbook",
        sourcemap: true,
      },
    ],
    plugins: [
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
    ],
  },
  {
    input: [
      "./dist/client/index.d.ts",
      "./dist/server/index.d.ts",
      "./dist/client/GrowthBookReact.d.ts",
    ],
    output: [{ file: "dist/index.d.ts", format: "es" }],
    plugins: [dts()],
  },
];
