const esm = {
  presets: [
    [
      "@babel/preset-env",
      {
        modules: false,
        targets: "defaults, not IE 11, maintained node versions",
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
