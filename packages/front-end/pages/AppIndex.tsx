import { AppProps } from "next/app";
import "@radix-ui/themes/styles.css";
import { OrganizationMessagesContainer } from "@/components/OrganizationMessages/OrganizationMessages";
import { DemoDataSourceGlobalBannerContainer } from "@/components/DemoDataSourceGlobalBanner/DemoDataSourceGlobalBanner";
import ProtectedPage from "@/components/ProtectedPage";
import { DefinitionsProvider } from "@/services/DefinitionsContext";
import "diff2html/bundles/css/diff2html.min.css";
import Layout from "@/components/Layout/Layout";
import { useAppearanceUITheme } from "@/services/AppearanceUIThemeProvider";
import TopNavLite from "@/components/Layout/TopNavLite";

type ModAppProps = AppProps & {
  Component: {
    noOrganization?: boolean;
    preAuth?: boolean;
    liteLayout?: boolean;
  };
};

function AppIndex({
  Component,
  pageProps,
  router,
}: ModAppProps): React.ReactElement {
  const { theme } = useAppearanceUITheme();
  const organizationRequired = !Component.noOrganization;
  const liteLayout = Component.liteLayout || false;
  const parts = router.route.substr(1).split("/");
  console.log(theme);
  return (
    <ProtectedPage organizationRequired={organizationRequired}>
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
    </ProtectedPage>
  );
}

export default AppIndex;
