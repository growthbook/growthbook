/* eslint-disable */
const rehypePrism = require("@mapbox/rehype-prism");

// eslint-disable-next-line
const withMDX = require("@next/mdx")({
  extension: /\.mdx?$/,
  options: {
    remarkPlugins: [],
    rehypePlugins: [
      rehypePrism,
    ],
  },
});
module.exports = withMDX({
  pageExtensions: ["js", "jsx", "ts", "tsx", "md", "mdx"],
  future: {
    webpack5: true,
  },
  redirects: async () => {
    return [
      {
        source: '/api-docs',
        destination: '/app/api',
        permanent: true,
      },
    ]
  }
});
