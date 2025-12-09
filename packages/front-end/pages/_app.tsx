// NB: Order matters
import "@radix-ui/themes/styles.css";
import "@/styles/radix-config.css";
import "@/styles/global-radix-overrides.scss";
import "@/styles/global.scss";

import { AppProps } from "next/app";
import Head from "next/head";
import React, { useEffect, useState } from "react";
import { GrowthBookProvider } from "@growthbook/growthbook-react";
import { growthbookTrackingPlugin } from "@growthbook/growthbook/plugins";
import { Inter } from "next/font/google";
import { OrganizationMessagesContainer } from "@/components/OrganizationMessages/OrganizationMessages";
import { DemoDataSourceGlobalBannerContainer } from "@/components/DemoDataSourceGlobalBanner/DemoDataSourceGlobalBanner";
import { PageHeadProvider } from "@/components/Layout/PageHead";
import { RadixTheme } from "@/services/RadixTheme";
import { AuthProvider, useAuth } from "@/services/auth";
import ProtectedPage from "@/components/ProtectedPage";
import {
  DefinitionsGuard,
  DefinitionsProvider,
} from "@/services/DefinitionsContext";
import {
  getIngestorHost,
  initEnv,
  inTelemetryDebugMode,
  isTelemetryEnabled,
} from "@/services/env";
import LoadingOverlay from "@/components/LoadingOverlay";
import "diff2html/bundles/css/diff2html.min.css";
import Layout from "@/components/Layout/Layout";
import { AppearanceUIThemeProvider } from "@/services/AppearanceUIThemeProvider";
import TopNavLite from "@/components/Layout/TopNavLite";
import GetStartedProvider from "@/services/GetStartedProvider";
import GuidedGetStartedBar from "@/components/Layout/GuidedGetStartedBar";
import LayoutLite from "@/components/Layout/LayoutLite";
import { growthbook } from "@/services/utils";
import { UserContextProvider } from "@/services/UserContext";
import { SidebarOpenProvider } from "@/components/Layout/SidebarOpenProvider";
import { CommandPaletteProvider } from "@/components/Layout/CommandPaletteContext";

// Make useLayoutEffect isomorphic (for SSR)
if (typeof window === "undefined") React.useLayoutEffect = React.useEffect;

// If loading a variable font, you don't need to specify the font weight
const inter = Inter({ subsets: ["latin"] });

type ModAppProps = AppProps & {
  Component: {
    envReady?: boolean;
    noOrganization?: boolean;
    liteLayout?: boolean;
    preAuth?: boolean;
    preAuthTopNav?: boolean;
    progressiveAuth?: boolean;
    progressiveAuthTopNav?: boolean;
    noLoadingOverlay?: boolean;
    mainClassName?: string;
  };
};

function App({
  Component,
  pageProps,
  router,
}: ModAppProps): React.ReactElement {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");

  // hacky:
  const parts = Component.mainClassName
    ? [Component.mainClassName]
    : router.route.substr(1).split("/");

  const organizationRequired = !Component.noOrganization;
  const preAuth = Component.preAuth || false;
  const progressiveAuth = Component.progressiveAuth || false;
  const preAuthTopNav = Component.preAuthTopNav || false;
  const progressiveAuthTopNav = Component.progressiveAuthTopNav || false;
  const liteLayout = Component.liteLayout || false;
  const noLoadingOverlay = Component.noLoadingOverlay || false;

  const { orgId } = useAuth();

  useEffect(() => {
    initEnv()
      .then(() => {
        setReady(true);
      })
      .catch((e) => {
        setError(e.message);
        console.error(e.message);
      });
  }, []);

  useEffect(() => {
    if (!ready) return;
    growthbookTrackingPlugin({
      ingestorHost: getIngestorHost(),
      enable: isTelemetryEnabled(),
      debug: inTelemetryDebugMode(),
      eventFilter: (event) => {
        // Wait for account plan to load before sending events
        // When the plan does load, the app will re-render, so no events will be lost
        if (event.attributes.accountPlan === "loading") return false;
        return true;
      },
      dedupeKeyAttributes: ["id", "organizationId"],
    })(growthbook);
  }, [ready]);

  useEffect(() => {
    // Load feature definitions JSON from GrowthBook API
    growthbook.init({ streaming: true }).catch(() => {
      console.log("Failed to fetch GrowthBook feature definitions");
    });
  }, []);

  const renderPreAuth = () => {
    if (!ready || !progressiveAuth) {
      return (
        <PageHeadProvider>
          {preAuthTopNav ? (
            <>
              <TopNavLite />
              <main className="container">
                <Component {...{ ...pageProps, envReady: ready }} />
              </main>
            </>
          ) : (
            <Component {...{ ...pageProps, envReady: ready }} />
          )}
        </PageHeadProvider>
      );
    }

    return (
      <AuthProvider exitOnNoAuth={!(preAuth || progressiveAuth)}>
        <UserContextProvider key={orgId}>
          <DefinitionsProvider>
            <PageHeadProvider>
              {preAuthTopNav || progressiveAuthTopNav ? (
                <>
                  <TopNavLite />
                  <main className={`main lite ${parts[0]}`}>
                    <Component {...{ ...pageProps, envReady: ready }} />
                  </main>
                </>
              ) : (
                <Component {...{ ...pageProps, envReady: ready }} />
              )}
            </PageHeadProvider>
          </DefinitionsProvider>
        </UserContextProvider>
      </AuthProvider>
    );
  };

  return (
    <>
      <style jsx global>{`
        html {
          font-family: var(--default-font-family);
          --default-font-family: ${inter.style.fontFamily};
        }
        body {
          font-family: var(--default-font-family);
        }
        .radix-themes {
          --default-font-family: ${inter.style.fontFamily};
        }
      `}</style>
      <Head>
        <title>GrowthBook</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      {ready || noLoadingOverlay ? (
        <AppearanceUIThemeProvider>
          <RadixTheme>
            <CommandPaletteProvider>
              <SidebarOpenProvider>
                <GrowthBookProvider growthbook={growthbook}>
                  <div id="portal-root" />
                  {preAuth || progressiveAuth ? (
                    renderPreAuth()
                  ) : (
                    <PageHeadProvider>
                      <AuthProvider>
                        <ProtectedPage
                          organizationRequired={organizationRequired}
                        >
                          {organizationRequired ? (
                            <GetStartedProvider>
                              <DefinitionsProvider>
                                {liteLayout ? <LayoutLite /> : <Layout />}
                                <main className={`main ${parts[0]}`}>
                                  <GuidedGetStartedBar />
                                  <OrganizationMessagesContainer />
                                  <DemoDataSourceGlobalBannerContainer />
                                  <DefinitionsGuard>
                                    <Component
                                      {...{ ...pageProps, envReady: ready }}
                                    />
                                  </DefinitionsGuard>
                                </main>
                              </DefinitionsProvider>
                            </GetStartedProvider>
                          ) : (
                            <div>
                              <TopNavLite />
                              <main className="container">
                                <Component
                                  {...{ ...pageProps, envReady: ready }}
                                />
                              </main>
                            </div>
                          )}
                        </ProtectedPage>
                      </AuthProvider>
                    </PageHeadProvider>
                  )}
                </GrowthBookProvider>
              </SidebarOpenProvider>
            </CommandPaletteProvider>
          </RadixTheme>
        </AppearanceUIThemeProvider>
      ) : error ? (
        <div className="container">
          <div className="alert alert-danger">
            Error Initializing GrowthBook: {error}
          </div>
        </div>
      ) : (
        <LoadingOverlay />
      )}
    </>
  );
}

export default App;
