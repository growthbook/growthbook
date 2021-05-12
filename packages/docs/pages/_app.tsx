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
    href: "/quick-start",
    name: "Quick Start",
  },
  {
    href: "/experiments",
    name: "Experiments",
  },
  {
    href: "/metrics",
    name: "Metrics",
  },
  {
    href: "/api-docs",
    name: "API",
  },
  {
    href: "/sources",
    name: "Data Sources",
    links: [
      {
        href: "/sources/athena",
        name: "Athena",
      },
      {
        href: "/sources/bigquery",
        name: "BigQuery",
      },
      {
        href: "/sources/google-analytics",
        name: "Google Analytics",
      },
      {
        href: "/sources/mixpanel",
        name: "Mixpanel",
      },
      {
        href: "/sources/postgres",
        name: "Postgres",
      },
      {
        href: "/sources/redshift",
        name: "Redshift",
      },
      {
        href: "/sources/snowflake",
        name: "Snowflake",
      },
    ],
  },
];

function App({
  Component,
  pageProps,
  router,
}: ModAppProps): React.ReactElement {
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
      </Head>
      <TopNav />
      <div className="container-fluid">
        <div className="row">
          <div className="col-md-3">
            <div
              className="bg-light border rounded sticky-top p-3 mb-3"
              style={{ maxHeight: "100vh", overflowY: "auto" }}
            >
              <div className="mb-1">
                <Link href="/">
                  <a className="text-muted h4">Docs</a>
                </Link>
              </div>
              {navLinks.map((link, i) => {
                const active = router.pathname === link.href;
                return (
                  <>
                    <div
                      className={`p-2 rounded`}
                      key={i}
                      style={{
                        backgroundColor: active ? "#ddd" : "",
                      }}
                    >
                      <Link href={link.href}>
                        <a>{link.name}</a>
                      </Link>
                    </div>

                    {link.links &&
                      link.links.map((sublink, j) => {
                        const active = router.pathname === sublink.href;
                        return (
                          <div
                            className={`p-2 rounded ml-3 d-none d-md-block`}
                            key={j}
                            style={{
                              backgroundColor: active ? "#ddd" : "",
                            }}
                          >
                            <Link href={sublink.href}>
                              <a>{sublink.name}</a>
                            </Link>
                          </div>
                        );
                      })}
                  </>
                );
              })}
            </div>
          </div>
          <div className="col pt-2">
            <Component {...pageProps} />
          </div>
        </div>
      </div>
    </>
  );
}

export default App;
