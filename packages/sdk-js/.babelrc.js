const sharedPresets = ["@babel/preset-typescript"];
const shared = {
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

module.exports = {
  ...shared,
  env: {
    esmUnbundled: shared,
    esmBundled: shared,
    cjs: {
      ...shared,
      presets: [
        [
          "@babel/preset-env",
          {
            modules: "commonjs",
          },
        ],
        ...sharedPresets,
      ],
    },
  },
};
