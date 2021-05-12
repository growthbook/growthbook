/* eslint-disable */
const rehypePrism = require("@mapbox/rehype-prism");
const addClasses = require("rehype-add-classes");

// eslint-disable-next-line
const withMDX = require("@next/mdx")({
  extension: /\.mdx?$/,
  options: {
    remarkPlugins: [],
    rehypePlugins: [
      rehypePrism, 
      [addClasses, {
        "table": "table table-bordered",
        "img": "border my-3"
      }]
    ],
  },
});
module.exports = withMDX({
  pageExtensions: ["js", "jsx", "ts", "tsx", "md", "mdx"],
  future: {
    webpack5: true,
  },
});
