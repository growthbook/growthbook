import babel from "@rollup/plugin-babel";
import resolve from "@rollup/plugin-node-resolve";
import replace from "@rollup/plugin-replace";
import commonjs from "@rollup/plugin-commonjs";

const extensions = [".js", ".ts", ".tsx", ".jsx"];

export default {
  input: "src/index.ts",
  external: (id) => {
    // Bundle local files
    if (id.startsWith('.') || id.startsWith('/') || id.startsWith('\0') || id.includes('src/')) {
      return false;
    }
    // Mark package imports as external (react, @growthbook/growthbook, etc.)
    return true;
  },
  output: [
    {
      file: "dist/esm/index.js",
      format: "esm",
      sourcemap: true,
    },
    {
      file: "dist/cjs/index.js",
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
};

