const sharedPresets = ["@babel/preset-react", "@babel/preset-typescript"];
const esm = {
  presets: [
    [
      "@babel/preset-env",
      {
        modules: false,
        targets: "defaults, not IE 11, maintained node versions",
      },
    ],
    ...sharedPresets,
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
    ...sharedPresets,
  ],
}

module.exports = {
  ...esm,
  env: {
    esmUnbundled: esm,
    cjs: cjs,
  },
};
