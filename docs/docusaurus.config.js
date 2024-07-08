// @ts-check
// Note: type annotations allow type checking and IDEs autocompletion

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: "GrowthBook Docs",
  tagline: "Open source feature flagging and A/B testing platform.",
  url: "https://docs.growthbook.io",
  baseUrl: "/",
  onBrokenLinks: "throw",
  onBrokenAnchors: "warn",
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

  // Kapa.ai chat bot on Docs page
  scripts: [
    {
      src: "https://widget.kapa.ai/kapa-widget.bundle.js",
      "data-website-id": "c4406b9f-35c5-43ca-b0c1-e7c0e261831f", // Safe to expose publicly
      "data-project-name": "GrowthBook",
      "data-project-color": "#7817d3",
      "data-modal-example-questions": "How do I run an experiment?",
      "data-project-logo":
        "https://docs.growthbook.io/images/chatbot-icon-white.png",
      async: true,
    },
  ],

  presets: [
    [
      "classic",
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: {
          breadcrumbs: true,
          remarkPlugins: [
            [require("@docusaurus/remark-plugin-npm2yarn"), { sync: true }],
            require("remark-math"),
          ],
          rehypePlugins: [require("rehype-katex")],
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
        gtag: {
          trackingID: "G-3W683MDLMQ",
        },
      }),
    ],
    [
      "redocusaurus",
      {
        // Plugin Options for loading OpenAPI files
        specs: [
          {
            spec: "../packages/back-end/generated/spec.yaml",
            route: "/api/",
          },
        ],
      },
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
            to: "/",
            label: "Docs",
            activeBaseRegex: "/(?!api)",
            position: "left",
          },
          {
            to: "/api",
            label: "API",
            position: "left",
          },
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
        theme: require("prism-react-renderer").themes.github,
        darkTheme: require("prism-react-renderer").themes.dracula,
        additionalLanguages: [
          "csharp",
          "ruby",
          "php",
          "java",
          "kotlin",
          "swift",
          "dart",
          "groovy",
          "scala",
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

  stylesheets: [
    {
      href: "https://cdn.jsdelivr.net/npm/katex@0.13.24/dist/katex.min.css",
      type: "text/css",
      integrity:
        "sha384-odtC+0UGzzFL/6PNoE8rX/SPcQDXBJ+uRepguP4QkPCm2LBxH3FA3y+fKSiJ+AmM",
      crossorigin: "anonymous",
    },
  ],
};

module.exports = config;
