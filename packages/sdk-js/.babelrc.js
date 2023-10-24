// eslint-disable-next-line @typescript-eslint/no-var-requires
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
    esmUnbundled: esm,
    cjs: cjs,
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
              value: JSON.stringify(version),
            },
          },
        ],
      },
    ],
  ],
};
