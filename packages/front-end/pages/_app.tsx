import { AppProps } from "next/app";
import "../styles/global.scss";
import "react-rangeslider/lib/index.css";
import { AuthProvider } from "../services/auth";
import ProtectedPage from "../components/ProtectedPage";
import Layout from "../components/Layout/Layout";
import { DataSourceProvider } from "../services/DatasourceContext";
import Head from "next/head";
import { MetricsProvider } from "../services/MetricsContext";
import { TagsProvider } from "../services/TagsContext";
import { SegmentsProvider } from "../services/SegmentsContext";
import { DimensionsProvider } from "../services/DimensionsContext";

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
        */}
        {process.env.NEXT_PUBLIC_DISABLE_TELEMETRY ? null : (
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
            <DataSourceProvider>
              <MetricsProvider>
                <SegmentsProvider>
                  <DimensionsProvider>
                    <TagsProvider>
                      <Layout />
                      <main className={`main ${parts[0]}`}>
                        <Component {...pageProps} />
                      </main>
                    </TagsProvider>
                  </DimensionsProvider>
                </SegmentsProvider>
              </MetricsProvider>
            </DataSourceProvider>
          ) : (
            <Component {...pageProps} />
          )}
        </ProtectedPage>
      </AuthProvider>
    </>
  );
}

export default App;
