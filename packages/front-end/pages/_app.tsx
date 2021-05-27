import { AppProps } from "next/app";
import "../styles/global.scss";
import "react-rangeslider/lib/index.css";
import { AuthProvider } from "../services/auth";
import ProtectedPage from "../components/ProtectedPage";
import Layout from "../components/Layout/Layout";
import Head from "next/head";
import { DefinitionsProvider } from "../services/DefinitionsContext";
import { isTelemetryEnabled } from "../services/track";
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

  return (
    <>
      <Head>
        <title>Growth Book</title>
        <meta name="robots" content="noindex, nofollow" />
        {/* 
        Track anonymous usage statistics using Plausible.io
        - No cookies or identifiable information are sent.
        - Helps us figure out what features are the most popular 
          and which ones need more work.
        - For example, if people start creating a metric and then 
          abandon the form, that tells us the UI needs improvement.
        - You can disable this tracking completely by setting 
          NEXT_PUBLIC_DISABLE_TELEMETRY=1 in your env.
        - To console.log the telemetry data instead of sending to Plausible,
          you can set NEXT_PUBLIC_TELEMETRY_DEBUG=1 in your env.
        */}
        {isTelemetryEnabled() && (
          <script
            async
            defer
            data-domain="app.growthbook.io"
            src="https://usage.growthbook.io/js/index.js"
          ></script>
        )}
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
