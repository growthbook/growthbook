import { FC, useEffect, useState } from "react";
import clsx from "clsx";
import { FaBars } from "react-icons/fa";
import { PiRobotBold } from "react-icons/pi";
import Head from "next/head";
import Breadcrumbs from "@/ui/Breadcrumbs";
import Button from "@/ui/Button";
import modalStandardStyles from "@/ui/Modal/Patterns/ModalStandard.module.scss";
import experimentHeaderStyles from "@/components/Experiment/TabbedPage/ExperimentHeader.module.scss";
import AccountPlanNotices from "@/components/Layout/AccountPlanNotices";
import { PayloadSizeTopNavNotice } from "@/components/Features/SDKConnections/PayloadSizeNotices";
import { useAgentPanel } from "@/components/Agent/AgentPanelContext";
import styles from "./TopNav.module.scss";
import { usePageHead } from "./PageHead";
import HeaderBreadcrumb from "./HeaderBreadcrumb";
import ProfileMenu from "./ProfileMenu";

// The app header (app header + side nav redesign,
// app-header-rail-handoff.md): 44px (set in review; 56px in the spec, tried 48px), white, no bottom border. The
// breadcrumb on the left (the project selector, then the section and the
// object on detail pages); on the right, the account notices, the
// GrowthBot (AI Assistant) button, with Phosphor's bold robot outline
// (set in review; was "Assistant" with a sparkle; tried the filled and
// regular robots). The avatar and its profile menu, and the divider before it,
// moved to the side nav (set in review), except on pages without one.
// The Enterprise badge, the org name and switcher (now in the profile menu)
// and the email beside the avatar are gone.
//
// LayoutLite's header (no side nav, e.g. Setup) keeps its title in place of
// the breadcrumb.
const TopNav: FC<{
  toggleLeftMenu?: () => void;
  pageTitle: string;
  showNotices?: boolean;
  showLogo?: boolean;
}> = ({ toggleLeftMenu, pageTitle, showNotices, showLogo = true }) => {
  // No line under the bar at the top of the page; a soft shadow once the
  // page scrolls under it, so the two stay apart.
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 0);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);

  const { breadcrumb } = usePageHead();

  const {
    available: agentAvailable,
    open: agentOpen,
    togglePanel: toggleAgentPanel,
  } = useAgentPanel();

  return (
    <>
      <Head>
        <title>{pageTitle ? `${pageTitle} | GrowthBook` : "GrowthBook"}</title>
      </Head>
      <div
        className={`navbar ${styles.topbar} mb-2 position-fixed${
          scrolled ? ` ${styles.scrolled}` : ""
        }${toggleLeftMenu ? ` ${styles.withRail}` : ""}`}
        // Stable hook for page-scoped overrides (the CSS module class name is
        // hashed).
        data-topbar=""
        style={{
          left: toggleLeftMenu ? undefined : 0,
        }}
      >
        <div className={styles.navbar}>
          {toggleLeftMenu ? (
            <a
              href="#main-menu"
              id="main-menu-toggle"
              className={styles.mobilemenu}
              aria-label="Open main menu"
              onClick={(e) => {
                e.preventDefault();
                toggleLeftMenu();
              }}
            >
              <span className="sr-only">Open main menu</span>
              <FaBars />
            </a>
          ) : showLogo ? (
            <div>
              <img
                alt="GrowthBook"
                src="/logo/growthbook-logo.png"
                style={{ height: 40 }}
              />
            </div>
          ) : null}
          <div className={styles.pagetitle}>
            {toggleLeftMenu ? (
              <HeaderBreadcrumb />
            ) : (
              <Breadcrumbs
                items={
                  breadcrumb.length > 0 ? breadcrumb : [{ display: pageTitle }]
                }
              />
            )}
          </div>
          <div className={styles.actions}>
            {showNotices && (
              <>
                <div className="nav-link">
                  <AccountPlanNotices />
                </div>
                <div className="nav-link">
                  <PayloadSizeTopNavNotice />
                </div>
              </>
            )}
            {/* PROTOTYPE: always shown (set in review), so the design's
              Assistant is represented. Where AI is available
              it opens the global AI Assistant drawer, as the sparkle did;
              elsewhere (no AI plan, or AI turned off) it does nothing.
              ⌘J is a placeholder in the design; no shortcut yet. */}
            {/* @/ui/Button styled as the experiment page's Check
              Hypothesis (HypothesisField.tsx; set in review): outline,
              grey, small; a --slate-6 outline darkening to --slate-9 on
              hover (.outlineButton), --slate-12 text and robot at 400
              (.ghostButton's weight), 6px corners, and Button's own 4px
              between icon and label. Tried: ghost (small, and medium at
              28px tall), 500 text, an 8px gap, violet. */}
            <Button
              variant="outline"
              color="gray"
              size="sm"
              className={clsx(
                experimentHeaderStyles.outlineButton,
                modalStandardStyles.ghostButton,
              )}
              style={{
                borderRadius: "var(--radius-3)",
                color: "var(--slate-12)",
              }}
              icon={<PiRobotBold />}
              onClick={agentAvailable ? toggleAgentPanel : undefined}
              aria-label={
                agentOpen
                  ? "Close GrowthBot, the GrowthBook AI assistant"
                  : "Open GrowthBot, the GrowthBook AI assistant"
              }
              aria-pressed={agentAvailable ? agentOpen : undefined}
            >
              GrowthBot
            </Button>
            {/* Pages without the side nav (LayoutLite) keep the avatar here. */}
            {toggleLeftMenu ? null : <ProfileMenu />}
          </div>
        </div>
      </div>
    </>
  );
};
export default TopNav;
