/* eslint-disable */
const rehypePrism = require("@mapbox/rehype-prism");
const rehypeSlug = require("rehype-slug");
const autoLink = require("rehype-autolink-headings");

// eslint-disable-next-line
const withMDX = require("@next/mdx")({
  extension: /\.mdx?$/,
  options: {
    remarkPlugins: [],
    rehypePlugins: [
      rehypePrism,
      rehypeSlug,
      autoLink
    ],
  },
});
module.exports = withMDX({
  pageExtensions: ["js", "jsx", "ts", "tsx", "md", "mdx"],
  swcMinify: true,
  redirects: async () => {
    return [
      {
        source: '/api-docs',
        destination: '/apidocs',
        permanent: true,
      },
      {
        source: '/app/api',
        destination: '/apidocs',
        permanent: true,
      },
    ]
  }
});
