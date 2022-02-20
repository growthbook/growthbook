import { AppProps } from "next/app";
import "../styles/global.scss";
import { AuthProvider } from "../services/auth";
import ProtectedPage from "../components/ProtectedPage";
import Layout from "../components/Layout/Layout";
import Head from "next/head";
import { DefinitionsProvider } from "../services/DefinitionsContext";
import { useEffect } from "react";
import track from "../services/track";
import { initEnv } from "../services/env";
import { useState } from "react";
import LoadingOverlay from "../components/LoadingOverlay";
import "diff2html/bundles/css/diff2html.min.css";
import { GrowthBook, GrowthBookProvider } from "@growthbook/growthbook-react";

type ModAppProps = AppProps & {
  Component: { noOrganization?: boolean; preAuth?: boolean };
};

const growthbook = new GrowthBook({
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
    fetch("https://cdn.growthbook.io/api/features/key_prod_cb40dfcb0eb98e44")
      .then((res) => res.json())
      .then((json) => {
        growthbook.setFeatures(json.features);
      })
      .catch(() => {
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
        <AuthProvider>
          <GrowthBookProvider growthbook={growthbook}>
            <ProtectedPage
              organizationRequired={organizationRequired}
              preAuth={preAuth}
            >
              {organizationRequired && !preAuth ? (
                <DefinitionsProvider>
                  <Layout />
                  <main className={`main ${parts[0]}`}>
                    <Component {...pageProps} />
                  </main>
                </DefinitionsProvider>
              ) : (
                <Component {...pageProps} />
              )}
            </ProtectedPage>
          </GrowthBookProvider>
        </AuthProvider>
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
