import babel from "@rollup/plugin-babel";
import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import copy from "rollup-plugin-copy";
import serve from "rollup-plugin-serve";
import livereload from "rollup-plugin-livereload";
import replace from "@rollup/plugin-replace";

const extensions = [".js", ".ts", ".tsx", ".jsx"];

export default {
  input: "src/playground/index.tsx",
  output: [
    {
      file: "dist/playground/index.js",
      format: "iife",
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
    copy({
      targets: [
        {
          src: "src/playground/index.html",
          dest: "dist/playground",
          transform: (contents) => {
            return contents.toString().replace("./index.tsx", "index.js");
          },
        },
      ],
    }),
    serve({
      contentBase: "dist/playground",
      port: process.env.NODE_PORT || 3300,
    }),
    livereload("dist/playground"),
  ],
};
