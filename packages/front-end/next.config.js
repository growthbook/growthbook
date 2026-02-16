const withBundleAnalyzer = require("@next/bundle-analyzer")({
  enabled: process.env.ANALYZE === "true",
});

const cspHeader = `
    frame-ancestors 'none';
`;

/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
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
  productionBrowserSourceMaps: true,
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
};

module.exports = withBundleAnalyzer(nextConfig);
