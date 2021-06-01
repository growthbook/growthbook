import * as React from "react";
import { AppProps } from "next/app";
import Head from "next/head";
import Link from "next/link";
import "tailwindcss/tailwind.css";
import { useEffect } from "react";
import { FaMoon, FaSun, FaChevronLeft, FaChevronRight } from "react-icons/fa";

type ModAppProps = AppProps & {
  Component: { noOrganization?: boolean; preAuth?: boolean };
};

const navLinks = [
  {
    href: "/",
    name: "Docs Home",
  },
  {
    href: "/app",
    name: "Growth Book App",
    links: [
      {
        href: "/app/datasources",
        name: "Data Sources",
      },
      {
        href: "/app/metrics",
        name: "Metrics",
      },
      {
        href: "/app/experiments",
        name: "Experiments",
      },
      {
        href: "/app/visual",
        name: "Visual Editor (beta)",
      },
    ],
  },
  {
    href: "/lib",
    name: "Client Libraries",
    links: [
      {
        href: "/lib/js",
        name: "Javascript",
      },
      {
        href: "/lib/react",
        name: "React",
      },
      {
        href: "/lib/php",
        name: "PHP",
      },
      {
        href: "/lib/ruby",
        name: "Ruby",
      },
    ],
  },
  {
    href: "/api-docs",
    name: "API",
  },
];

const linksInOrder: { name: string; href: string }[] = [
  { name: "Docs Home", href: "/" },
];
navLinks.forEach((l) => {
  linksInOrder.push({ name: l.name, href: l.href });
  if (l.links) {
    l.links.forEach((l2) => {
      linksInOrder.push(l2);
    });
  }
});

function App({
  Component,
  pageProps,
  router,
}: ModAppProps): React.ReactElement {
  const [dark, setDark] = React.useState<null | boolean>(null);
  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);
  useEffect(() => {
    if (dark === null) return;
    if (dark) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
    try {
      localStorage.theme = dark ? "dark" : "light";
    } catch (e) {
      // ignore local storage errors
    }
  }, [dark]);

  // Scroll to top of content div when the route changes
  useEffect(() => {
    const handleRouteChange = () => {
      document.querySelector("main").scrollTop = 0;
    };
    router.events.on("routeChangeComplete", handleRouteChange);
    return () => {
      router.events.off("routeChangeComplete", handleRouteChange);
    };
  }, []);

  let currentIndex = -1;
  linksInOrder.forEach((l, i) => {
    if (l.href === router.pathname) {
      currentIndex = i;
    }
  });

  return (
    <div className="h-screen dark:bg-gray-800">
      <Head>
        <title>Growth Book Docs</title>
        <meta name="robots" content="noindex, nofollow" />
        <link
          rel="preload"
          href="https://cdn.jsdelivr.net/npm/prism-themes@1.7.0/themes/prism-dracula.css"
          as="style"
        />
        <link
          rel="stylesheet"
          type="text/css"
          href="https://cdn.jsdelivr.net/npm/prism-themes@1.7.0/themes/prism-dracula.css"
        />
        <link rel="preconnect" href="https://fonts.gstatic.com" />
        <link
          rel="preload"
          href="https://fonts.googleapis.com/css2?family=Source+Sans+Pro:ital,wght@0,400;0,700;1,400&display=swap"
          as="style"
        />{" "}
        <link
          href="https://fonts.googleapis.com/css2?family=Source+Sans+Pro:ital,wght@0,400;0,700;1,400&display=swap"
          rel="stylesheet"
        ></link>
        <style>{`
        body {
          font-family: 'Source Sans Pro', sans-serif;
        }
        pre[class*="language-"] {
          margin-bottom: 1rem;
        }
        img {
          max-width: 100%;
        }
        html {
          color-scheme: light;
        }
        html.dark {
          color-scheme: dark;
        }
        `}</style>
        <script
          dangerouslySetInnerHTML={{
            __html: `
            try {
              if (localStorage.theme === 'dark' || (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
                document.documentElement.classList.add('dark')
              } else {
                document.documentElement.classList.remove('dark')
              }
            }
            catch(e) {}
            `,
          }}
        />
      </Head>
      <div className="flex h-full w-full">
        <div className="max-w-0 md:max-w-lg p-0 overflow-x-hidden h-full md:p-5 overflow-y-auto border-r border-gray-200 dark:border-gray-600 dark:text-gray-200">
          <div className="">
            <Link href="/">
              <a>
                <img src="/growth-book-logo.png" className="w-48 mb-6" />
              </a>
            </Link>

            {navLinks.map((link, i) => {
              const active = router.pathname === link.href;
              return (
                <div key={i} className="mb-2">
                  <div
                    className={`rounded py-1 px-2 ${
                      active
                        ? "bg-gray-200 dark:bg-gray-600 font-bold"
                        : "hover:bg-gray-100 dark:hover:bg-gray-700"
                    }`}
                  >
                    <Link href={link.href}>
                      <a className="block">{link.name}</a>
                    </Link>
                  </div>

                  {link.links &&
                    link.links.map((sublink, j) => {
                      const active = router.pathname === sublink.href;
                      return (
                        <div
                          className={`rounded py-1 px-2 ml-4 ${
                            active
                              ? "bg-gray-200 dark:bg-gray-600 font-bold"
                              : "hover:bg-gray-100 dark:hover:bg-gray-700"
                          }`}
                          key={j}
                        >
                          <Link href={sublink.href}>
                            <a className="block">{sublink.name}</a>
                          </Link>
                        </div>
                      );
                    })}
                </div>
              );
            })}
          </div>
        </div>
        <div className="flex flex-col h-screen flex-grow">
          <nav className="sticky top-0 z-10 px-3 md:px-5 py-4 bg-white dark:bg-gray-800 border-b border-gray-100 dark:border-gray-600 flex">
            <div className="hidden md:block text-lg text-gray-600 dark:text-gray-400">
              <a href="https://www.growthbook.io" className="mr-6">
                Home
              </a>
              <a
                href="https://github.com/growthbook/growthbook"
                className="mr-6"
              >
                GitHub
              </a>
              <a href="https://app.growthbook.io">Try for free</a>
            </div>
            <div className="flex md:hidden items-center text-sm">
              <Link href="/">
                <a className="block">
                  <img src="/growth-book-logo.png" className="w-32 mr-3" />
                </a>
              </Link>

              <select
                className="bg-gray-200 text-gray-800 dark:bg-gray-600 dark:text-gray-100 p-1 mx-1 rounded"
                placeholder="Jump to Section"
                value={router.pathname}
                onChange={(e) => {
                  router.push(e.target.value);
                }}
              >
                {navLinks.map((link) => (
                  <React.Fragment key={link.href}>
                    <option value={link.href}>{link.name}</option>
                    {link.links &&
                      link.links.map((sublink) => (
                        <option value={sublink.href} key={sublink.href}>
                          &nbsp;&nbsp;⊢&nbsp;{sublink.name}
                        </option>
                      ))}
                  </React.Fragment>
                ))}
              </select>
            </div>
            <div className="flex-grow"></div>
            <button
              className="text-gray-100 text-xl bg-gray-800 w-8 h-8 text-center hover:bg-gray-700 dark:bg-gray-200 dark:text-gray-800 dark:hover:bg-gray-300 rounded-full"
              onClick={(e) => {
                e.preventDefault();
                setDark(!dark);
              }}
              title={dark ? "Switch to light mode" : "Switch to dark mode"}
            >
              {dark ? (
                <FaSun className="mx-auto" />
              ) : (
                <FaMoon className="mx-auto" />
              )}
            </button>
          </nav>
          <main className="p-5 flex-grow overflow-y-auto">
            <div className="prose prose-purple lg:prose-lg dark:prose-dark max-w-3xl">
              <Component {...pageProps} />
            </div>
          </main>
          {currentIndex >= 0 && (
            <div className="p-5 border-t border-gray-100 dark:border-gray-600">
              <footer className="dark:text-gray-200 max-w-3xl">
                <div className="flex">
                  {currentIndex > 0 && (
                    <div className="flex">
                      <Link href={linksInOrder[currentIndex - 1].href}>
                        <a className="flex items-center">
                          <FaChevronLeft /> Previous
                        </a>
                      </Link>
                      <span className="hidden md:inline opacity-60 ml-2">
                        ({linksInOrder[currentIndex - 1].name})
                      </span>
                    </div>
                  )}
                  <div className="text-center flex-grow mx-4 opacity-60">
                    <a
                      className="hidden lg:inline"
                      href={`https://github.com/growthbook/growthbook/blob/main/packages/docs/pages${
                        router.pathname
                      }${
                        ["/lib", "/app"].includes(router.pathname)
                          ? "/index"
                          : ""
                      }${router.pathname === "/" ? "index" : ""}.mdx`}
                    >
                      Edit this page on GitHub
                    </a>
                  </div>
                  {currentIndex < linksInOrder.length - 1 && (
                    <div className="flex">
                      <span className="hidden md:inline opacity-60 mr-2">
                        ({linksInOrder[currentIndex + 1].name})
                      </span>
                      <Link href={linksInOrder[currentIndex + 1].href}>
                        <a className="flex items-center">
                          Next <FaChevronRight />
                        </a>
                      </Link>
                    </div>
                  )}
                </div>
              </footer>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
