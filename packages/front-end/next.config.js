// eslint-disable-next-line @typescript-eslint/no-var-requires
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
  eslint: {
    ignoreDuringBuilds: true,
  },
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
  webpack: (config) => {
    config.module.rules.push({
      test: /ace-builds.*\/worker-.*$/,
      type: "asset/resource",
    });
    return config;
  },
};

module.exports = withBundleAnalyzer(nextConfig);
