const sharedPresets = ["@babel/typescript"];
const shared = {
  presets: [
    [
      "@babel/env",
      {
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
          "@babel/env",
          {
            modules: "commonjs",
          },
        ],
        ...sharedPresets,
      ],
    },
  },
};
