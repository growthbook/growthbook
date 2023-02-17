// @ts-check
// Note: type annotations allow type checking and IDEs autocompletion

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: "GrowthBook Docs",
  tagline: "Open source feature flagging and A/B testing platform.",
  url: "https://docs.growthbook.io",
  baseUrl: "/",
  onBrokenLinks: "throw",
  onBrokenMarkdownLinks: "warn",
  favicon: "img/favicon.ico",

  // GitHub pages deployment config.
  // If you aren't using GitHub pages, you don't need these.
  organizationName: "growthbook", // Usually your GitHub org/user name.
  projectName: "growthbook", // Usually your repo name.

  // Even if you don't use internalization, you can use this field to set useful
  // metadata like html lang. For example, if your site is Chinese, you may want
  // to replace "en" with "zh-Hans".
  i18n: {
    defaultLocale: "en",
    locales: ["en"],
  },

  presets: [
    [
      "classic",
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: {
          remarkPlugins: [
            [require("@docusaurus/remark-plugin-npm2yarn"), { sync: true }],
          ],
          sidebarPath: require.resolve("./sidebars.js"),
          routeBasePath: "/", // Serve the docs at the site's root
          // Please change this to your repo.
          // Remove this to remove the "edit this page" links.
          editUrl: "https://github.com/growthbook/growthbook/edit/main/docs/",
        },
        blog: false,
        theme: {
          customCss: [
            require.resolve("./src/styles/custom.scss"),
            require.resolve("modern-normalize/modern-normalize.css"),
          ],
        },
      }),
    ],
  ],

  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    {
      navbar: {
        //hideOnScroll: true,
        //title: 'GrowthBook Docs',
        logo: {
          alt: "GrowthBook Docs",
          src: "img/growthbook-docslogo-light.png",
          srcDark: "img/growthbook-docslogo-dark.png",
        },
        items: [
          {
            href: "https://growthbook.io",
            label: "Home",
            position: "right",
          },
          {
            href: "https://app.growthbook.io",
            label: "Log in / sign up",
            position: "right",
          },
          {
            href: "https://github.com/growthbook/growthbook",
            label: "GitHub",
            position: "right",
          },
          {
            label: "Support",
            position: "right",
            items: [
              {
                href: "https://slack.growthbook.io",
                label: "Join our Slack",
                target: "_blank",
                rel: null,
              },
              {
                href:
                  "https://github.com/growthbook/growthbook/issues/new/choose",
                label: "Open an issue",
                target: "_blank",
                rel: null,
              },
            ],
            className: "navbar__link--support",
          },
        ],
      },
      metadata: [
        {
          name: "og:image",
          content: "https://cdn.growthbook.io/growthbook-github-card.png",
        },
        {
          name: "twitter:image",
          content: "https://cdn.growthbook.io/growthbook-github-card.png",
        },
        {
          name: "twitter:card",
          content: "summary_large_image",
        },
        {
          name: "twitter:domain",
          content: "growthbook.io",
        },
        {
          name: "twitter:site",
          content: "@growth_book",
        },
        {
          name: "twitter:creator",
          content: "growthbook",
        },
        {
          name: "og:type",
          content: "website",
        },
        {
          name: "og:site_name",
          content: "GrowthBook Docs",
        },
      ],
      prism: {
        theme: require("prism-react-renderer/themes/github"),
        darkTheme: require("prism-react-renderer/themes/dracula"),
        additionalLanguages: [
          "csharp",
          "ruby",
          "php",
          "java",
          "kotlin",
          "swift",
          "dart",
          "groovy",
        ],
      },
      colorMode: {
        defaultMode: "light",
        disableSwitch: false,
        respectPrefersColorScheme: true,
      },
      algolia: {
        // The application ID provided by Algolia
        appId: "MN7ZMY63CG",

        // Public API key: it is safe to commit it
        apiKey: "43a7bc1b7a1494649e79a9fa7c3376be",

        indexName: "growthbook",

        // Optional: see doc section below
        contextualSearch: true,

        // Optional: Specify domains where the navigation should occur through window.location instead on history.push. Useful when our Algolia config crawls multiple documentation sites and we want to navigate with window.location.href to them.
        //externalUrlRegex: "external\\.com|domain\\.com",

        // Optional: Algolia search parameters
        searchParameters: {},

        // Optional: path for search page that enabled by default (`false` to disable it)
        searchPagePath: "search",

        //... other Algolia params
      },
    },
  plugins: ["docusaurus-plugin-sass"],
};

module.exports = config;
