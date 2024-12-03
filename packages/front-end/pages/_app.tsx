// NB: Order matters
import "@radix-ui/themes/styles.css";
import "@/styles/radix-config.css";
import "@/styles/global-radix-overrides.scss";
import "@/styles/global.scss";

import { AppProps } from "next/app";
import Head from "next/head";
import { useEffect, useState } from "react";
import { GrowthBookProvider } from "@growthbook/growthbook-react";
import { Inter } from "next/font/google";
import { OrganizationMessagesContainer } from "@/components/OrganizationMessages/OrganizationMessages";
import { DemoDataSourceGlobalBannerContainer } from "@/components/DemoDataSourceGlobalBanner/DemoDataSourceGlobalBanner";
import { PageHeadProvider } from "@/components/Layout/PageHead";
import { RadixTheme } from "@/services/RadixTheme";
import { AuthProvider } from "@/services/auth";
import ProtectedPage from "@/components/ProtectedPage";
import {
  DefinitionsGuard,
  DefinitionsProvider,
} from "@/services/DefinitionsContext";
import { initEnv, isTelemetryEnabled } from "@/services/env";
import LoadingOverlay from "@/components/LoadingOverlay";
import "diff2html/bundles/css/diff2html.min.css";
import Layout from "@/components/Layout/Layout";
import { AppearanceUIThemeProvider } from "@/services/AppearanceUIThemeProvider";
import TopNavLite from "@/components/Layout/TopNavLite";
import GetStartedProvider from "@/services/GetStartedProvider";
import GuidedGetStartedBar from "@/components/Layout/GuidedGetStartedBar";
import LayoutLite from "@/components/Layout/LayoutLite";
import { growthbook, gbContext } from "@/services/utils";

// If loading a variable font, you don't need to specify the font weight
const inter = Inter({ subsets: ["latin"] });

type ModAppProps = AppProps & {
  Component: {
    noOrganization?: boolean;
    preAuth?: boolean;
    liteLayout?: boolean;
    preAuthTopNav?: boolean;
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
  const parts = router.route.substr(1).split("/");

  const organizationRequired = !Component.noOrganization;
  const preAuth = Component.preAuth || false;
  const preAuthTopNav = Component.preAuthTopNav || false;
  const liteLayout = Component.liteLayout || false;

  useEffect(() => {
    initEnv()
      .then(() => {
        setReady(true);
      })
      .catch((e) => {
        setError(e.message);
      });
  }, []);

  useEffect(() => {
    if (!ready) return;
    if (isTelemetryEnabled()) {
      let _rtQueue: { key: string; on: boolean }[] = [];
      let _rtTimer = 0;
      gbContext.onFeatureUsage = (key, res) => {
        _rtQueue.push({
          key,
          on: res.on,
        });
        if (!_rtTimer) {
          _rtTimer = window.setTimeout(() => {
            // Reset the queue
            _rtTimer = 0;
            const q = [_rtQueue];
            _rtQueue = [];

            window
              .fetch(
                `https://rt.growthbook.io/?key=key_prod_cb40dfcb0eb98e44&events=${encodeURIComponent(
                  JSON.stringify(q)
                )}`,

                {
                  cache: "no-cache",
                  mode: "no-cors",
                }
              )
              .catch(() => {
                // TODO: retry in case of network errors?
              });
          }, 2000);
        }
      };
    }
  }, [ready]);

  useEffect(() => {
    // Load feature definitions JSON from GrowthBook API
    growthbook.init({ streaming: true }).catch(() => {
      console.log("Failed to fetch GrowthBook feature definitions");
    });
  }, []);

  const renderPreAuth = () => {
    if (preAuthTopNav) {
      return (
        <>
          <TopNavLite />
          <main className="container mt-5">
            <Component {...pageProps} />
          </main>
        </>
      );
    }
    return <Component {...pageProps} />;
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
      {ready ? (
        <AppearanceUIThemeProvider>
          <RadixTheme>
            <div id="portal-root" />
            {preAuth ? (
              renderPreAuth()
            ) : (
              <PageHeadProvider>
                <AuthProvider>
                  <GrowthBookProvider growthbook={growthbook}>
                    <ProtectedPage organizationRequired={organizationRequired}>
                      {organizationRequired ? (
                        <GetStartedProvider>
                          <DefinitionsProvider>
                            {liteLayout ? <LayoutLite /> : <Layout />}
                            <main className={`main ${parts[0]}`}>
                              <GuidedGetStartedBar />
                              <OrganizationMessagesContainer />
                              <DemoDataSourceGlobalBannerContainer />
                              <DefinitionsGuard>
                                <Component {...pageProps} />
                              </DefinitionsGuard>
                            </main>
                          </DefinitionsProvider>
                        </GetStartedProvider>
                      ) : (
                        <div>
                          <TopNavLite />
                          <main className="container mt-5">
                            <Component {...pageProps} />
                          </main>
                        </div>
                      )}
                    </ProtectedPage>
                  </GrowthBookProvider>
                </AuthProvider>
              </PageHeadProvider>
            )}
          </RadixTheme>
        </AppearanceUIThemeProvider>
      ) : error ? (
        <div className="container mt-3">
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
