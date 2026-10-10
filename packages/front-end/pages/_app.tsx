// NB: Order matters
import "@radix-ui/themes/styles.css";
import "@/styles/radix-config.css";
import "@/styles/global-radix-overrides.scss";
import "@/styles/global.scss";

import { AppProps } from "next/app";
import Head from "next/head";
import React, { useEffect, useState } from "react";
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
import { ToastProvider } from "@/ui/Toast";
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

  // Page transitions (set in review): moving to another page (e.g. the
  // experiments list to an experiment) cross-fades the main content area
  // with the View Transitions API: the old page fades out quickly and the
  // new one fades in with a slight rise (tried a cross-fade with a focus pull,
  // and a shared-title morph, in review); the top bar and sidebar stay put
  // (styles below). Only a change of page: not a hash change (tabs) or a
  // query change on the same page, and not shallow routing. The content
  // area takes its view-transition-name only for the transition, so it
  // isn't a stacking context the rest of the time. Browsers without the
  // API navigate as before; none for reduced motion.
  useEffect(() => {
    if (
      typeof document.startViewTransition !== "function" ||
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }
    let finish: (() => void) | null = null;
    const onStart = (url: string, { shallow }: { shallow: boolean }) => {
      if (shallow) return;
      const next = new URL(url, window.location.origin).pathname;
      if (next === window.location.pathname) return;
      finish?.();
      const navigated = new Promise<void>((resolve) => {
        finish = resolve;
      });
      document.documentElement.classList.add("page-transition");
      const transition = document.startViewTransition(() => navigated);
      transition.finished.finally(() => {
        document.documentElement.classList.remove("page-transition");
      });
    };
    const onDone = () => {
      finish?.();
      finish = null;
    };
    router.events.on("routeChangeStart", onStart);
    router.events.on("routeChangeComplete", onDone);
    router.events.on("routeChangeError", onDone);
    return () => {
      router.events.off("routeChangeStart", onStart);
      router.events.off("routeChangeComplete", onDone);
      router.events.off("routeChangeError", onDone);
      onDone();
    };
  }, [router]);

  return (
    <>
      <style jsx global>{`
        /* Page transitions (see the effect above): only the main content
          area animates; the rest of the page holds still. */
        html.page-transition main.main {
          view-transition-name: page-main;
        }
        ::view-transition-old(root),
        ::view-transition-new(root) {
          animation: none;
        }
        ::view-transition-old(page-main) {
          animation: page-out 120ms ease-out both;
        }
        ::view-transition-new(page-main) {
          animation: page-in 240ms cubic-bezier(0.22, 1, 0.36, 1) both;
        }
        @keyframes page-out {
          to {
            opacity: 0;
          }
        }
        @keyframes page-in {
          from {
            opacity: 0;
            transform: translateY(6px);
          }
          to {
            opacity: 1;
            transform: none;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          ::view-transition-old(page-main),
          ::view-transition-new(page-main) {
            animation: none;
          }
        }
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
      <AppearanceUIThemeProvider>
        <RadixTheme>
          {/* Toasts, for anywhere in the app (@/ui/Toast). */}
          <ToastProvider>
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
                                      {liteLayout ? <LayoutLite /> : <Layout />}
                                      <CommandPaletteLauncher />
                                      <AgentLauncher />
                                      <main className={`main ${parts[0]}`}>
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
          </ToastProvider>
        </RadixTheme>
      </AppearanceUIThemeProvider>
    </>
  );
}

export default App;
