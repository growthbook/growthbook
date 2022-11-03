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
};
