const fs = require("fs");
const path = require("path");

const rootPath = path.join(__dirname, "..", "..");

let gitSha = "";
let gitCommitDate = "";
if (fs.existsSync(path.join(rootPath, "buildinfo", "SHA"))) {
  gitSha = fs
    .readFileSync(path.join(rootPath, "buildinfo", "SHA"))
    .toString()
    .trim();
}
if (fs.existsSync(path.join(rootPath, "buildinfo", "DATE"))) {
  gitCommitDate = fs
    .readFileSync(path.join(rootPath, "buildinfo", "DATE"))
    .toString()
    .trim();
}

fs.writeFileSync(
  path.join(__dirname, "styles", "variables.scss"),
  `$public-asset-prefix: "${
    process.env.USE_REMOTE_ASSETS
      ? `https://growthbook-cloud-static-files.s3.amazonaws.com/${gitCommitDate}/${gitSha}/public`
      : ""
  }";`
);

const cspHeader = `
    frame-ancestors 'none';
`;

module.exports = {
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
      ],
    },
  ],
  assetPrefix: process.env.USE_REMOTE_ASSETS
    ? `https://growthbook-cloud-static-files.s3.amazonaws.com/${gitCommitDate}/${gitSha}/`
    : "",
};
