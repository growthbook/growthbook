const withBundleAnalyzer = require("@next/bundle-analyzer")({
  enabled: process.env.ANALYZE === "true",
});

const cspHeader = `
    frame-ancestors 'none';
`;

/** @type {import('next').NextConfig} */
const nextConfig = {
  // We already run eslint and typescript in CI/CD
  // Disable here to speed up production builds
  typescript: {
    ignoreBuildErrors: true,
  },
  turbopack: {
    // Ace workers: load as raw text so we can create Blob URLs. Turbopack doesn't support
    // webpack's asset/resource the same way - raw-loader gives us the worker source,
    // which we convert to blob: URLs that Ace can load.
    rules: {
      "**/ace-builds/**/worker-*.js": {
        loaders: ["raw-loader"],
        as: "*.js",
      },
    },
  },
  experimental: {
    turbopackFileSystemCacheForDev: true,
    turbopackFileSystemCacheForBuild: true,
  },
  sassOptions: {
    silenceDeprecations: [
      "legacy-js-api",
      "import",
      "slash-div",
      "color-functions",
      "global-builtin",
      "abs-percent",
    ],
  },
  headers: () => [
    {
      source: "/(.*)",
      headers: [
        {
          key: "Content-Security-Policy",
          value: cspHeader.replace(/\n/g, ""),
        },
        {
          key: "X-Frame-Options",
          value: "deny",
        },
        {
          key: "Cross-Origin-Opener-Policy",
          value: "same-origin",
        },
      ],
    },
  ],
  transpilePackages: ["echarts", "zrender"],
  webpack: (config) => {
    // Ace workers: use raw-loader (same as Turbopack) so we get source and create
    // Blob URLs. asset/resource only works with webpack, not Turbopack.
    config.module.rules.push({
      test: /ace-builds.*\/worker-.*\.js$/,
      use: "raw-loader",
    });

    // Suppress OpenTelemetry dynamic require warnings from Sentry
    config.ignoreWarnings = [
      ...(config.ignoreWarnings || []),
      {
        module: /@opentelemetry\/instrumentation/,
        message:
          /Critical dependency: the request of a dependency is an expression/,
      },
    ];

    return config;
  },
  productionBrowserSourceMaps: true,
};

module.exports = withBundleAnalyzer(nextConfig);
