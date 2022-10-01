import { AppProps } from "next/app";
import "../styles/global.scss";
import Head from "next/head";
import { useEffect, useState } from "react";
import track from "../services/track";
import { initEnv } from "../services/env";
import LoadingOverlay from "../components/LoadingOverlay";
import "diff2html/bundles/css/diff2html.min.css";
import { GrowthBook, GrowthBookProvider } from "@growthbook/growthbook-react";
import dynamic from "next/dynamic";
import type { ProtectedPageProps } from "../components/ProtectedPage";

const Layout = dynamic(() => import("../components/Layout/Layout"), {
  ssr: false,
});
const AuthProvider = dynamic(
  async () => (await import("../services/auth")).AuthProvider,
  { ssr: false }
);
const DefinitionsProvider = dynamic(
  async () =>
    (await import("../services/DefinitionsContext")).DefinitionsProvider,
  { ssr: false }
);
const ProtectedPage = dynamic<ProtectedPageProps>(
  () => import("../components/ProtectedPage"),
  { ssr: false }
);

type ModAppProps = AppProps & {
  Component: {
    noOrganization?: boolean;
    preAuth?: boolean;
    liteLayout?: boolean;
  };
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
        preAuth ? (
          <Component {...pageProps} />
        ) : (
          <AuthProvider>
            <GrowthBookProvider growthbook={growthbook}>
              <ProtectedPage organizationRequired={organizationRequired}>
                {organizationRequired ? (
                  <DefinitionsProvider>
                    {!liteLayout && <Layout />}
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
