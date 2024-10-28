import Cookies from "js-cookie";
import { AppProps } from "next/app";
import "@/styles/global.scss";
import "@/styles/global-radix-overrides.scss";
import "@radix-ui/themes/styles.css";
import "@/styles/theme-config.css";
import Head from "next/head";
import { useEffect, useState } from "react";
import {
  Context,
  GrowthBook,
  GrowthBookProvider,
  BrowserCookieStickyBucketService,
} from "@growthbook/growthbook-react";
import { Inter } from "next/font/google";
import { OrganizationMessagesContainer } from "@/components/OrganizationMessages/OrganizationMessages";
import { DemoDataSourceGlobalBannerContainer } from "@/components/DemoDataSourceGlobalBanner/DemoDataSourceGlobalBanner";
import { PageHeadProvider } from "@/components/Layout/PageHead";
import { RadixTheme } from "@/services/RadixTheme";
import { AuthProvider } from "@/services/auth";
import ProtectedPage from "@/components/ProtectedPage";
import { DefinitionsProvider } from "@/services/DefinitionsContext";
import track from "@/services/track";
import { initEnv, isTelemetryEnabled } from "@/services/env";
import LoadingOverlay from "@/components/LoadingOverlay";
import "diff2html/bundles/css/diff2html.min.css";
import Layout from "@/components/Layout/Layout";
import { AppearanceUIThemeProvider } from "@/services/AppearanceUIThemeProvider";
import TopNavLite from "@/components/Layout/TopNavLite";
import { AppFeatures } from "@/./types/app-features";
import GetStartedProvider from "@/services/GetStartedProvider";
import GuidedGetStartedBar from "@/components/Layout/GuidedGetStartedBar";
import LayoutLite from "@/components/Layout/LayoutLite";
import { GB_SDK_ID } from "@/services/utils";

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

const gbContext: Context = {
  apiHost: "https://cdn.growthbook.io",
  clientKey: GB_SDK_ID,
  enableDevMode: true,
  trackingCallback: (experiment, result) => {
    track("Experiment Viewed", {
      experimentId: experiment.key,
      variationId: result.variationId,
    });
  },
  stickyBucketService: new BrowserCookieStickyBucketService({
    jsCookie: Cookies,
  }),
};
export const growthbook = new GrowthBook<AppFeatures>(gbContext);

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
      gbContext.realtimeKey = "key_prod_cb40dfcb0eb98e44";
    }
    track("App Load");
  }, [ready]);

  useEffect(() => {
    // Load feature definitions JSON from GrowthBook API
    growthbook.init({ streaming: true }).catch(() => {
      console.log("Failed to fetch GrowthBook feature definitions");
    });
  }, []);

  useEffect(() => {
    if (!ready) return;
    growthbook.setURL(window.location.href);
    track("page-load", {
      pathName: router.pathname,
    });
  }, [ready, router.pathname]);

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
                              <Component {...pageProps} />
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
