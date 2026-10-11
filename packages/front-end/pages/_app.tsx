// NB: Order matters
import "@radix-ui/themes/styles.css";
import "@/styles/radix-config.css";
import "@/styles/global-radix-overrides.scss";
import "@/styles/global.scss";

import { AppProps } from "next/app";
import Head from "next/head";
import { useRouter } from "next/router";
import React, { useEffect, useState } from "react";
import { GrowthBookProvider } from "@growthbook/growthbook-react";
import { growthbookTrackingPlugin } from "@growthbook/growthbook/plugins";
import { Inter } from "next/font/google";
import { Container } from "@radix-ui/themes";
import { ROUTE_PROGRESS_START_EVENT } from "@/components/Experiment/slowNavigationDemo";
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

// A thin progress bar while a page change is loading (set in review): while
// Next loads the new page, if that takes more than 150ms, and then while
// the new page shows its LoadingOverlay (the page transition holds the old
// page for up to 300ms first), until it's gone, up to 20 seconds. Styled in
// App's global styles (.route-progress).
function RouteProgressBar() {
  const router = useRouter();
  const [active, setActive] = useState(false);
  useEffect(() => {
    let frame = 0;
    let slow: ReturnType<typeof setTimeout> | undefined;
    const html = document.documentElement;
    const stop = () => {
      cancelAnimationFrame(frame);
      clearTimeout(slow);
      html.classList.remove("route-loading");
      setActive(false);
    };
    const onStart = (url: string, { shallow }: { shallow: boolean }) => {
      if (shallow) return;
      // Straight away, so its animation is running before the main thread
      // gets busy rendering the new page (which would hold up a timer); the
      // CSS keeps it invisible for its first 150ms (.route-progress).
      clearTimeout(slow);
      setActive(true);
    };
    const onDone = () => {
      cancelAnimationFrame(frame);
      clearTimeout(slow);
      const started = performance.now();
      let seen = false;
      const check = () => {
        const loading = !!document.querySelector("main [data-loading-overlay]");
        const elapsed = performance.now() - started;
        if (loading && elapsed < 20000) {
          if (!seen) {
            seen = true;
            html.classList.add("route-loading");
            setActive(true);
          }
          frame = requestAnimationFrame(check);
        } else if (!seen && elapsed < 500) {
          // Give the new page a moment to show its overlay.
          frame = requestAnimationFrame(check);
        } else {
          stop();
        }
      };
      check();
    };
    // Also started by the prototype's fake slow load
    // (components/Experiment/slowNavigationDemo.ts).
    const onDemoStart = () => setActive(true);
    window.addEventListener(ROUTE_PROGRESS_START_EVENT, onDemoStart);
    router.events.on("routeChangeStart", onStart);
    router.events.on("routeChangeComplete", onDone);
    router.events.on("routeChangeError", stop);
    return () => {
      window.removeEventListener(ROUTE_PROGRESS_START_EVENT, onDemoStart);
      router.events.off("routeChangeStart", onStart);
      router.events.off("routeChangeComplete", onDone);
      router.events.off("routeChangeError", stop);
      stop();
    };
  }, [router]);
  return (
    <>
      <div
        className="route-progress"
        data-active={active ? "true" : undefined}
        aria-hidden
      />
      {/* A white veil over the page while it loads (set in review). */}
      <div
        className="route-progress-veil"
        data-active={active ? "true" : undefined}
        aria-hidden
      />
    </>
  );
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

  // No smooth scroll while the page changes (set in review): global.scss
  // makes scrolling smooth, so the router's jump to the new page's top
  // played as a visible scroll as it came in (e.g. opening an experiment
  // from low in the list). The class holds from the change's start until a
  // frame after it completes; smooth scrolling elsewhere is unchanged.
  useEffect(() => {
    const html = document.documentElement;
    const onStart = () => html.classList.add("route-changing");
    const onDone = () =>
      requestAnimationFrame(() => html.classList.remove("route-changing"));
    router.events.on("routeChangeStart", onStart);
    router.events.on("routeChangeComplete", onDone);
    router.events.on("routeChangeError", onDone);
    return () => {
      router.events.off("routeChangeStart", onStart);
      router.events.off("routeChangeComplete", onDone);
      router.events.off("routeChangeError", onDone);
      html.classList.remove("route-changing");
    };
  }, [router]);

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
    // Back and forward (popstate) keep the scroll the browser restores;
    // anything else starts the new page at its top.
    let fromHistory = false;
    const onPopState = () => {
      fromHistory = true;
    };
    window.addEventListener("popstate", onPopState);
    const onStart = (url: string, { shallow }: { shallow: boolean }) => {
      const restoreScroll = fromHistory;
      fromHistory = false;
      if (shallow) return;
      const next = new URL(url, window.location.origin).pathname;
      if (next === window.location.pathname) return;
      finish?.();
      // Seamless (set in review): while the transition holds the old page
      // on screen, the new one finishes loading (its LoadingOverlay gone,
      // for up to 300ms; was a second, which read as a pause) and is moved
      // to its top, so neither a spinner nor the scroll up shows as it
      // comes in; only then is it revealed. Still loading after that, it's
      // revealed with the progress bar below.
      const navigated = new Promise<void>((resolve) => {
        finish = () => {
          const started = performance.now();
          const reveal = () => {
            const loading = document.querySelector(
              "main [data-loading-overlay]",
            );
            if (loading && performance.now() - started < 300) {
              requestAnimationFrame(reveal);
              return;
            }
            if (!restoreScroll) {
              window.scrollTo({ top: 0, left: 0, behavior: "instant" });
            }
            // The content area is named for the new page only (see the
            // styles below): the old page stays in the screenshot of what
            // was on screen.
            document.documentElement.classList.remove("page-leaving");
            document.documentElement.classList.add("page-transition");
            resolve();
          };
          reveal();
        };
      });
      // page-leaving names what leaves on its own (the Create Experiment
      // modal); page-transition, added once the new page is in, names its
      // content area.
      document.documentElement.classList.add("page-leaving");
      const transition = document.startViewTransition(() => navigated);
      transition.finished.finally(() => {
        document.documentElement.classList.remove(
          "page-leaving",
          "page-transition",
        );
      });
    };
    const onDone = () => {
      finish?.();
      finish = null;
    };
    // Started just before the new page renders (beforeHistoryChange), not
    // when the change starts (set in review): the transition freezes the
    // screen, and frozen from the start, the time Next takes to load the
    // page showed as a pause with nothing moving. Until then the old page
    // stays live, with the progress bar (RouteProgressBar) if it's slow.
    router.events.on("beforeHistoryChange", onStart);
    router.events.on("routeChangeComplete", onDone);
    router.events.on("routeChangeError", onDone);
    return () => {
      router.events.off("beforeHistoryChange", onStart);
      router.events.off("routeChangeComplete", onDone);
      router.events.off("routeChangeError", onDone);
      window.removeEventListener("popstate", onPopState);
      onDone();
    };
  }, [router]);

  return (
    <>
      <style jsx global>{`
        /* The route progress bar (RouteProgressBar): 2px along the very
          top of the window, above the top bar, in the accent; a violet
          segment sweeps across it while the new page loads, and it fades
          out when it's done. Still, full width, for reduced motion. While
          it shows, the page's loading spinner is hidden: the bar says the
          same thing. */
        .route-progress {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          z-index: 2000;
          height: 2px;
          overflow: hidden;
          pointer-events: none;
          opacity: 0;
          will-change: opacity;
          transition: opacity 200ms ease-out;
        }
        /* Shown after 150ms, so quick changes show nothing. Opacity and
          transform only, so the browser keeps them moving off the main
          thread even while it's busy rendering the new page. */
        .route-progress[data-active="true"] {
          opacity: 1;
          transition-delay: 150ms;
        }
        .route-progress::before {
          content: "";
          position: absolute;
          top: 0;
          bottom: 0;
          left: 0;
          width: 40%;
          will-change: transform;
          background: linear-gradient(
            90deg,
            transparent,
            var(--violet-9) 30%,
            var(--violet-9) 70%,
            transparent
          );
          animation: route-progress-sweep 1100ms cubic-bezier(0.4, 0, 0.2, 1)
            infinite;
        }
        @keyframes route-progress-sweep {
          from {
            transform: translateX(-100%);
          }
          to {
            transform: translateX(250%);
          }
        }
        /* The veil (set in review): the page's white at 60% over the
          content area, below the top bar and right of the sidebar (which
          stay crisp), fading in and out with the bar, after the same
          150ms. It takes clicks while it shows, so a second click can't
          start another page change. */
        .route-progress-veil {
          position: fixed;
          top: 56px;
          left: 240px;
          right: 0;
          bottom: 0;
          z-index: 1005;
          background-color: var(--color-panel-solid, #fff);
          opacity: 0;
          pointer-events: none;
          will-change: opacity;
          transition: opacity 200ms ease-out;
        }
        .route-progress-veil[data-active="true"] {
          opacity: 0.6;
          pointer-events: auto;
          transition-delay: 150ms;
        }
        @media (max-width: 1180px) {
          .route-progress-veil {
            left: 0;
          }
        }
        html.route-loading main [data-loading-overlay] > * {
          visibility: hidden;
        }
        @media (prefers-reduced-motion: reduce) {
          .route-progress::before {
            animation: none;
            left: 0;
            width: 100%;
            background: var(--violet-9);
          }
        }
        /* The jump to a new page's top is instant, not smooth (see the
          route-changing effect above). */
        html.route-changing {
          scroll-behavior: auto;
        }
        /* Page transitions (see the effect above): only the main content
          area animates; the rest of the page holds still. */
        /* The new page's content area rises in over the old page, which
          fades out as the screenshot of what was on screen (the root): the
          content area is named for the new page only. Named on both, the
          browser moved it from where the old page's was, which, scrolled
          down a long list, played as a scroll back up (fixed in review).
          The top bar and sidebar are the same in both, so the old page
          fading over the new root leaves them still. */
        html.page-transition main.main {
          view-transition-name: page-main;
        }
        ::view-transition-old(root) {
          animation: page-out 120ms ease-out both;
        }
        ::view-transition-new(root) {
          animation: none;
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
        /* The Create Experiment modal, named for the move to the new
          experiment's page (SimpleNewExperimentForm.module.scss): it fades
          out, a little smaller and lower, with its backdrop, while the new
          page rises in (set in review). */
        ::view-transition-old(create-experiment-modal) {
          animation: create-modal-out 220ms cubic-bezier(0.22, 1, 0.36, 1) both;
        }
        ::view-transition-old(create-experiment-backdrop) {
          animation: page-out 260ms ease-out both;
        }
        @keyframes create-modal-out {
          to {
            opacity: 0;
            transform: translateY(8px) scale(0.98);
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
          {/* Inside the theme, for its colour tokens (the veil's white). */}
          <RouteProgressBar />
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
