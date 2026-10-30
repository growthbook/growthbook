// NB: Order matters
import "@radix-ui/themes/styles.css";
import "@/styles/radix-config.css";
import "@/styles/global-radix-overrides.scss";
import "@/styles/global.scss";

import { AppProps } from "next/app";
import Head from "next/head";
import clsx from "clsx";
import React, { Fragment, useEffect, useState } from "react";
import { GrowthBookProvider } from "@growthbook/growthbook-react";
import { growthbookTrackingPlugin } from "@growthbook/growthbook/plugins";
import { Inter } from "next/font/google";
import { Container } from "@radix-ui/themes";
import { OrganizationMessagesContainer } from "@/components/OrganizationMessages/OrganizationMessages";
import { OrgSuspendedBannerContainer } from "@/components/OrgSuspendedBanner/OrgSuspendedBanner";
import { DemoDataSourceGlobalBannerContainer } from "@/components/DemoDataSourceGlobalBanner/DemoDataSourceGlobalBanner";
import NPSSurvey from "@/components/NPSSurvey/NPSSurvey";
import { PageHeadProvider } from "@/components/Layout/PageHead";
import { RadixTheme } from "@/services/RadixTheme";
import { AuthProvider, useAuth } from "@/services/auth";
import ProtectedPage from "@/components/ProtectedPage";
import {
  DefinitionsGuard,
  DefinitionsProvider,
} from "@/services/DefinitionsContext";
import {
  getIngestorHost,
  initEnv,
  inTelemetryDebugMode,
  isTelemetryEnabled,
} from "@/services/env";
import LoadingOverlay from "@/components/LoadingOverlay";
import "diff2html/bundles/css/diff2html.min.css";
import "react-grid-layout/css/styles.css";
import Layout from "@/components/Layout/Layout";
import { AppearanceUIThemeProvider } from "@/services/AppearanceUIThemeProvider";
import TopNavLite from "@/components/Layout/TopNavLite";
import GetStartedProvider from "@/services/GetStartedProvider";
import GuidedGetStartedBar from "@/components/Layout/GuidedGetStartedBar";
import LayoutLite from "@/components/Layout/LayoutLite";
import { growthbook } from "@/services/utils";
import { UserContextProvider, useUser } from "@/services/UserContext";
import { SidebarOpenProvider } from "@/components/Layout/SidebarOpenProvider";
import { SettingsNavProvider } from "@/components/Layout/SettingsNavContext";
import { SettingsFormProvider } from "@/components/GeneralSettings/SettingsFormProvider";
import { isSettingsRoute } from "@/components/Layout/sidebarNav";
import { HoverTooltipProvider } from "@/hooks/useHoverTooltip";
import { FeatureHealthStatesProvider } from "@/hooks/useFeatureHealthStates";
import { CommandPaletteLauncher } from "@/components/CommandPalette/CommandPalette";
import AgentLauncher from "@/components/Agent/AgentLauncher";
import { AgentPanelProvider } from "@/components/Agent/AgentPanelContext";
import Callout from "@/ui/Callout";

// Make useLayoutEffect isomorphic (for SSR)
if (typeof window === "undefined") React.useLayoutEffect = React.useEffect;

// If loading a variable font, you don't need to specify the font weight
const inter = Inter({ subsets: ["latin"] });
// The system's own monospace font on each platform, never a browser default.
const CODE_FONT_FAMILY =
  'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';
// Their lowercase runs from Consolas's short to Menlo's tall; sized by it, code
// reads the same whichever one the platform has.
const CODE_FONT_X_HEIGHT = 0.5;

type ModAppProps = AppProps & {
  Component: {
    envReady?: boolean;
    noOrganization?: boolean;
    liteLayout?: boolean;
    preAuth?: boolean;
    preAuthTopNav?: boolean;
    progressiveAuth?: boolean;
    progressiveAuthTopNav?: boolean;
    noLoadingOverlay?: boolean;
    mainClassName?: string;
  };
};

// Its own component: dynamic styled-jsx adds a scoped className to every
// element in the rendering component, including Fragments, which reject it.
function GlobalFontStyles() {
  return (
    <style jsx global>{`
      html {
        font-family: var(--default-font-family);
        --default-font-family: ${inter.style.fontFamily};
        --code-font-family: ${CODE_FONT_FAMILY};
        --code-font-x-height: ${CODE_FONT_X_HEIGHT};
      }
      body {
        font-family: var(--default-font-family);
      }
      .radix-themes {
        --default-font-family: ${inter.style.fontFamily};
        --code-font-family: ${CODE_FONT_FAMILY};
      }
      code[class*="language-"],
      pre[class*="language-"] {
        font-size-adjust: var(--code-font-x-height);
      }
    `}</style>
  );
}

// Renders definitions and page content only when the org is not suspended.
// Keeps the layout (nav) and banners outside so the org switcher stays usable.
function OrgPageContent({ children }: { children: React.ReactNode }) {
  const { orgSuspended } = useUser();
  if (orgSuspended) return null;
  return <>{children}</>;
}

function App({
  Component,
  pageProps,
  router,
}: ModAppProps): React.ReactElement {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");

  // hacky:
  const parts = Component.mainClassName
    ? [Component.mainClassName]
    : router.route.substr(1).split("/");

  const organizationRequired = !Component.noOrganization;
  const preAuth = Component.preAuth || false;
  const progressiveAuth = Component.progressiveAuth || false;
  const preAuthTopNav = Component.preAuthTopNav || false;
  const progressiveAuthTopNav = Component.progressiveAuthTopNav || false;
  const liteLayout = Component.liteLayout || false;
  const noLoadingOverlay = Component.noLoadingOverlay || false;
  const inSettings = isSettingsRoute(router.route);
  // The Settings draft only exists while inside Settings; leaving unmounts it.
  const SettingsForm = inSettings ? SettingsFormProvider : Fragment;

  const { orgId } = useAuth();

  useEffect(() => {
    initEnv()
      .then(() => {
        setReady(true);
      })
      .catch((e) => {
        setError(e.message);
        console.error(e.message);
      });
  }, []);

  useEffect(() => {
    if (!ready) return;
    growthbookTrackingPlugin({
      ingestorHost: getIngestorHost(),
      enable: isTelemetryEnabled(),
      debug: inTelemetryDebugMode(),
      eventFilter: (event) => {
        // Wait for account plan to load before sending events
        // When the plan does load, the app will re-render, so no events will be lost
        if (event.attributes.accountPlan === "loading") return false;
        return true;
      },
      dedupeKeyAttributes: ["id", "organizationId"],
    })(growthbook);
  }, [ready]);

  useEffect(() => {
    // Load feature definitions JSON from GrowthBook API
    growthbook.init({ streaming: true }).catch(() => {
      console.log("Failed to fetch GrowthBook feature definitions");
    });
  }, []);

  const renderPreAuth = () => {
    if (!ready || !progressiveAuth) {
      return (
        <PageHeadProvider>
          {preAuthTopNav ? (
            <>
              <TopNavLite />
              <main className="container">
                <Component {...{ ...pageProps, envReady: ready }} />
              </main>
            </>
          ) : (
            <Component {...{ ...pageProps, envReady: ready }} />
          )}
        </PageHeadProvider>
      );
    }

    return (
      <AuthProvider exitOnNoAuth={!(preAuth || progressiveAuth)}>
        <UserContextProvider key={orgId}>
          <DefinitionsProvider>
            <PageHeadProvider>
              {preAuthTopNav || progressiveAuthTopNav ? (
                <>
                  <TopNavLite />
                  <main className={`main lite ${parts[0]}`}>
                    <Component {...{ ...pageProps, envReady: ready }} />
                  </main>
                </>
              ) : (
                <Component {...{ ...pageProps, envReady: ready }} />
              )}
            </PageHeadProvider>
          </DefinitionsProvider>
        </UserContextProvider>
      </AuthProvider>
    );
  };

  return (
    <>
      <GlobalFontStyles />
      <Head>
        <title>GrowthBook</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      <AppearanceUIThemeProvider>
        <RadixTheme>
          {ready || noLoadingOverlay ? (
            <HoverTooltipProvider>
              <SidebarOpenProvider>
                <GrowthBookProvider growthbook={growthbook}>
                  <div id="portal-root" />
                  {preAuth || progressiveAuth ? (
                    renderPreAuth()
                  ) : (
                    <PageHeadProvider>
                      <AuthProvider>
                        <ProtectedPage
                          organizationRequired={organizationRequired}
                        >
                          {organizationRequired ? (
                            <GetStartedProvider>
                              <DefinitionsProvider>
                                <FeatureHealthStatesProvider>
                                  <AgentPanelProvider>
                                    <SettingsNavProvider>
                                      <SettingsForm>
                                        {liteLayout ? (
                                          <LayoutLite />
                                        ) : (
                                          <Layout />
                                        )}
                                        <CommandPaletteLauncher />
                                        <AgentLauncher />
                                        <main
                                          className={clsx("main", parts[0], {
                                            "settings-layout": inSettings,
                                          })}
                                        >
                                          <OrgSuspendedBannerContainer />
                                          <OrganizationMessagesContainer />
                                          <DemoDataSourceGlobalBannerContainer />
                                          <NPSSurvey />
                                          <OrgPageContent>
                                            <GuidedGetStartedBar />
                                            <DefinitionsGuard>
                                              <Component
                                                {...{
                                                  ...pageProps,
                                                  envReady: ready,
                                                }}
                                              />
                                            </DefinitionsGuard>
                                          </OrgPageContent>
                                        </main>
                                      </SettingsForm>
                                    </SettingsNavProvider>
                                  </AgentPanelProvider>
                                </FeatureHealthStatesProvider>
                              </DefinitionsProvider>
                            </GetStartedProvider>
                          ) : (
                            <div>
                              <TopNavLite />
                              <main className="container">
                                <Component
                                  {...{ ...pageProps, envReady: ready }}
                                />
                              </main>
                            </div>
                          )}
                        </ProtectedPage>
                      </AuthProvider>
                    </PageHeadProvider>
                  )}
                </GrowthBookProvider>
              </SidebarOpenProvider>
            </HoverTooltipProvider>
          ) : error ? (
            <Container mt="9">
              <Callout status="error">
                Error Initializing GrowthBook:
                <br />
                <br />
                {error}
              </Callout>
            </Container>
          ) : (
            <LoadingOverlay />
          )}
        </RadixTheme>
      </AppearanceUIThemeProvider>
    </>
  );
}

export default App;
