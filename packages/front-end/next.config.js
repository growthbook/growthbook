module.exports = {
  // We already run eslint and typescript in CI/CD
  // Disable here to speed up production builds
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
}