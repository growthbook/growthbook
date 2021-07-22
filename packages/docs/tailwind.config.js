// eslint-disable-next-line
const path = require("path");

const round = (num) =>
  num
    .toFixed(7)
    .replace(/(\.[0-9]+?)0+$/, "$1")
    .replace(/\.0$/, "");
const em = (px, base) => `${round(px / base)}em`;

module.exports = {
  purge: {
    content: [path.join(__dirname, "pages", "**", "*.{tsx,mdx}")],
    options: {
      safelist: ["border", "justify-content", "pb-4"],
    },
  },
  theme: {
    extend: {
      typography(theme) {
        return {
          DEFAULT: {
            css: {
              lineHeight: "1.5",
              h2: {
                marginTop: "1.5em",
              },
              ul: {
                marginTop: "0.75em",
                marginBottom: "1.25em",
              },
              "> ul > li > *:first-child": {
                marginTop: em(12, 16),
              },
              "> ul > li > *:last-child": {
                marginBottom: em(12, 16),
              },
              code: {
                color: theme("colors.pink.600"),
                borderColor: theme("colors.gray.200"),
                padding: "3px 6px",
                borderWidth: 1,
                fontWeight: 400,
                borderRadius: 5,
              },
              "code::before": {
                content: '""',
              },
              "code::after": {
                content: '""',
              },
            },
          },
          lg: {
            css: {
              lineHeight: "1.5",
              h2: {
                marginTop: "1.5em",
              },
              ul: {
                marginTop: "0.75em",
                marginBottom: "1.25em",
              },
              "> ul > li > *:first-child": {
                marginTop: em(12, 16),
              },
              "> ul > li > *:last-child": {
                marginBottom: em(12, 16),
              },
            },
          },
          dark: {
            css: {
              color: theme("colors.gray.300"),
              '[class~="lead"]': { color: theme("colors.gray.400") },
              a: { color: theme("colors.purple.400") },
              strong: { color: theme("colors.gray.100") },
              "ul > li::before": { backgroundColor: theme("colors.gray.700") },
              hr: { borderColor: theme("colors.gray.800") },
              blockquote: {
                color: theme("colors.gray.100"),
                borderLeftColor: theme("colors.gray.800"),
              },
              h1: { color: theme("colors.gray.100") },
              h2: { color: theme("colors.gray.100") },
              h3: { color: theme("colors.gray.100") },
              h4: { color: theme("colors.gray.100") },
              code: {
                color: theme("colors.green.300"),
                borderColor: theme("colors.gray.700"),
              },
              "a code": { color: theme("colors.gray.100") },
              pre: {
                color: theme("colors.gray.200"),
                backgroundColor: theme("colors.gray.800"),
              },
              "pre code": {
                color: "inherit",
              },
              thead: {
                color: theme("colors.gray.100"),
                borderBottomColor: theme("colors.gray.700"),
              },
              "tbody tr": { borderBottomColor: theme("colors.gray.800") },
            },
          },
        };
      },
    },
  },
  variants: {
    extend: {
      typography: ["dark"],
    },
  },
  plugins: [require("@tailwindcss/typography")],
  darkMode: "class",
};
