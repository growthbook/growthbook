import { AppProps } from "next/app";
import "../styles/global.scss";
import "react-rangeslider/lib/index.css";
import { AuthProvider } from "../services/auth";
import ProtectedPage from "../components/ProtectedPage";
import Layout from "../components/Layout/Layout";
import Head from "next/head";
import { DefinitionsProvider } from "../services/DefinitionsContext";
import { useEffect } from "react";
import track from "../services/track";
import { hasFileConfig, initEnv } from "../services/env";
import { useState } from "react";
import LoadingOverlay from "../components/LoadingOverlay";
type ModAppProps = AppProps & {
  Component: { noOrganization?: boolean; preAuth?: boolean };
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
    track("App Load", {
      configFile: hasFileConfig(),
    });
  }, [ready]);

  return (
    <>
      <Head>
        <title>Growth Book</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      {ready ? (
        <AuthProvider>
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
        </AuthProvider>
      ) : error ? (
        <div className="container mt-3">
          <div className="alert alert-danger">
            Error Initializing Growth Book: {error}
          </div>
        </div>
      ) : (
        <LoadingOverlay />
      )}
    </>
  );
}

export default App;
