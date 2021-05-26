import * as React from "react";
import { AppProps } from "next/app";
import Head from "next/head";
import TopNav from "../components/TopNav";
import Link from "next/link";

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
  let currentIndex = -1;
  linksInOrder.forEach((l, i) => {
    if (l.href === router.pathname) {
      currentIndex = i;
    }
  });

  return (
    <>
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
        <link
          rel="preload"
          href="https://cdn.jsdelivr.net/npm/bootstrap@4.6.0/dist/css/bootstrap.min.css"
          as="style"
        />
        <link
          rel="stylesheet"
          type="text/css"
          href="https://cdn.jsdelivr.net/npm/bootstrap@4.6.0/dist/css/bootstrap.min.css"
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
        `}</style>
        <style>{``}</style>
      </Head>
      <TopNav />
      <div className="container-fluid">
        <div className="row">
          <div className="col-md-3 col-xl-2">
            <div className="d-flex d-md-none pb-3 sticky-top border-bottom align-items-center">
              <div className="mr-2">Jump&nbsp;to:</div>
              <div className="w-100">
                <div>
                  <select
                    className="form-control"
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
              </div>
            </div>

            <div
              className="d-none d-md-block bg-light border rounded sticky-top p-3 mb-3"
              style={{ maxHeight: "100vh", overflowY: "auto" }}
            >
              <h4 className="text-muted">Menu</h4>
              {navLinks.map((link, i) => {
                const active = router.pathname === link.href;
                return (
                  <div key={i}>
                    <div
                      className={`rounded`}
                      style={{
                        backgroundColor: active ? "#ddd" : "",
                        fontWeight: active ? "bold" : "normal",
                      }}
                    >
                      <Link href={link.href}>
                        <a className="p-2 d-block">{link.name}</a>
                      </Link>
                    </div>

                    {link.links &&
                      link.links.map((sublink, j) => {
                        const active = router.pathname === sublink.href;
                        return (
                          <div
                            className={`rounded ml-3`}
                            key={j}
                            style={{
                              backgroundColor: active ? "#ddd" : "",
                            }}
                          >
                            <Link href={sublink.href}>
                              <a className="p-2 d-block">{sublink.name}</a>
                            </Link>
                          </div>
                        );
                      })}
                  </div>
                );
              })}
            </div>
          </div>
          <div className="col pt-2">
            <div className="d-flex flex-column h-100">
              <main style={{ flex: 1 }}>
                <Component {...pageProps} />
              </main>
              {currentIndex >= 0 && (
                <footer className="mt-4 border-top mb-2">
                  <div className="row p-4">
                    {currentIndex > 0 && (
                      <div className="col-auto">
                        <Link href={linksInOrder[currentIndex - 1].href}>
                          <a>&#x2039; Previous</a>
                        </Link>
                        <span className="d-none text-muted d-md-inline ml-2">
                          ({linksInOrder[currentIndex - 1].name})
                        </span>
                      </div>
                    )}
                    <div className="col"></div>
                    {currentIndex < linksInOrder.length - 1 && (
                      <div className="col-auto">
                        <span className="d-none text-muted d-md-inline mr-2">
                          ({linksInOrder[currentIndex + 1].name})
                        </span>
                        <Link href={linksInOrder[currentIndex + 1].href}>
                          <a>Next &#x203A;</a>
                        </Link>
                      </div>
                    )}
                  </div>
                  <div className="text-center border-top p-4">
                    <a
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
                </footer>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

export default App;
