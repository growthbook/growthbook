import { AppProps } from "next/app";
import "../styles/global.scss";
import Head from "next/head";
import { useEffect, useState } from "react";
import { GrowthBook, GrowthBookProvider } from "@growthbook/growthbook-react";
import { Theme } from "@radix-ui/themes";
import { OrganizationMessagesContainer } from "@/components/OrganizationMessages/OrganizationMessages";
import { DemoDataSourceGlobalBannerContainer } from "@/components/DemoDataSourceGlobalBanner/DemoDataSourceGlobalBanner";
import { PageHeadProvider } from "@/components/Layout/PageHead";
import { AuthProvider } from "../services/auth";
import ProtectedPage from "../components/ProtectedPage";
import { DefinitionsProvider } from "../services/DefinitionsContext";
import track from "../services/track";
import { initEnv } from "../services/env";
import LoadingOverlay from "../components/LoadingOverlay";
import "diff2html/bundles/css/diff2html.min.css";
import Layout from "../components/Layout/Layout";
import { AppearanceUIThemeProvider } from "../services/AppearanceUIThemeProvider";
import TopNavLite from "../components/Layout/TopNavLite";
import { AppFeatures } from "../types/app-features";
import "@radix-ui/themes/styles.css";

type ModAppProps = AppProps & {
  Component: {
    noOrganization?: boolean;
    preAuth?: boolean;
    liteLayout?: boolean;
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

  return (
    <>
      <Head>
        <title>GrowthBook</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      {ready ? (
        preAuth ? (
          <Component {...pageProps} />
        ) : (
          <PageHeadProvider>
            <AuthProvider>
              <AppearanceUIThemeProvider>
                <GrowthBookProvider growthbook={growthbook}>
                  <ProtectedPage organizationRequired={organizationRequired}>
                    <Theme accentColor="violet">
                      {organizationRequired ? (
                        <DefinitionsProvider>
                          {!liteLayout && <Layout />}
                          <main className={`main ${parts[0]}`}>
                            <OrganizationMessagesContainer />
                            <DemoDataSourceGlobalBannerContainer />
                            <Component {...pageProps} />
                          </main>
                        </DefinitionsProvider>
                      ) : (
                        <div>
                          <TopNavLite />
                          <main className="container mt-5">
                            <Component {...pageProps} />
                          </main>
                        </div>
                      )}
                    </Theme>
                  </ProtectedPage>
                </GrowthBookProvider>
              </AppearanceUIThemeProvider>
            </AuthProvider>
          </PageHeadProvider>
        )
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
