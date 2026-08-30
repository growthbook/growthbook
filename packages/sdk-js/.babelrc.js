const { version } = require("./package.json");

const esm = {
  presets: [
    [
      "@babel/preset-env",
      {
        modules: false,
      },
    ],
    ["@babel/preset-typescript"],
  ],
};
const cjs = {
  presets: [
    [
      "@babel/preset-env",
      {
        modules: "commonjs",
      },
    ],
    ["@babel/preset-typescript"],
  ],
};

module.exports = {
  ...esm,
  env: {
    esmUnbundled: {
      ...esm,
      ignore: ["./src/auto-wrapper.ts"],
      plugins: [["replace-import-extension", { extMapping: { "": ".mjs" } }]],
    },
    cjs: {
      ...cjs,
      ignore: ["./src/auto-wrapper.ts"],
    },
  },
  plugins: [
    [
      "minify-replace",
      {
        replacements: [
          {
            identifierName: "__SDK_VERSION__",
            replacement: {
              type: "stringLiteral",
              value: version,
            },
          },
        ],
      },
    ],
  ],
};
