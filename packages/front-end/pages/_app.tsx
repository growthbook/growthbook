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
type ModAppProps = AppProps & {
  Component: { noOrganization?: boolean; preAuth?: boolean };
};

function App({
  Component,
  pageProps,
  router,
}: ModAppProps): React.ReactElement {
  // hacky:
  const parts = router.route.substr(1).split("/");

  const organizationRequired = !Component.noOrganization;
  const preAuth = Component.preAuth || false;

  useEffect(() => {
    track("App Load");
  }, []);

  return (
    <>
      <Head>
        <title>Growth Book</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>
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
    </>
  );
}

export default App;
