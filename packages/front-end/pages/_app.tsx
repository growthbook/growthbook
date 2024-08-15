import { AppProps } from "next/app";
import "@front-end/styles/global.scss";
import "@radix-ui/themes/styles.css";
import "@front-end/styles/theme-config.css";
import Head from "next/head";
import { useEffect, useState } from "react";
import { GrowthBook, GrowthBookProvider } from "@growthbook/growthbook-react";
import { Inter } from "next/font/google";
import { OrganizationMessagesContainer } from "@front-end/components/OrganizationMessages/OrganizationMessages";
import { DemoDataSourceGlobalBannerContainer } from "@front-end/components/DemoDataSourceGlobalBanner/DemoDataSourceGlobalBanner";
import { PageHeadProvider } from "@front-end/components/Layout/PageHead";
import { RadixTheme } from "@front-end/services/RadixTheme";
import { AuthProvider } from "@front-end/services/auth";
import ProtectedPage from "@front-end/components/ProtectedPage";
import { DefinitionsProvider } from "@front-end/services/DefinitionsContext";
import track from "@front-end/services/track";
import { initEnv } from "@front-end/services/env";
import LoadingOverlay from "@front-end/components/LoadingOverlay";
import "diff2html/bundles/css/diff2html.min.css";
import Layout from "@front-end/components/Layout/Layout";
import { AppearanceUIThemeProvider } from "@front-end/services/AppearanceUIThemeProvider";
import TopNavLite from "@front-end/components/Layout/TopNavLite";
import { AppFeatures } from "@front-end/./types/app-features";
import GetStartedProvider from "@front-end/services/GetStartedProvider";
import GuidedGetStartedBar from "@front-end/components/Layout/GuidedGetStartedBar";

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

export const growthbook = new GrowthBook<AppFeatures>({
  apiHost: "https://cdn.growthbook.io",
  clientKey:
    process.env.NODE_ENV === "production"
      ? "sdk-ueFMOgZ2daLa0M"
      : "sdk-UmQ03OkUDAu7Aox",
  enableDevMode: true,
  subscribeToChanges: true,
  realtimeKey: "key_prod_cb40dfcb0eb98e44",
  trackingCallback: (experiment, result) => {
    track("Experiment Viewed", {
      experimentId: experiment.key,
      variationId: result.variationId,
    });
  },
});

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
    track("App Load");
  }, [ready]);

  useEffect(() => {
    // Load feature definitions JSON from GrowthBook API
    growthbook.loadFeatures().catch(() => {
      console.log("Failed to fetch GrowthBook feature definitions");
    });
  }, [router.pathname]);

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
                            {!liteLayout && <Layout />}
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
