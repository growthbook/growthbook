import { FC, useEffect, useState } from "react";
import { FaBars } from "react-icons/fa";
import Head from "next/head";
import Breadcrumbs from "@/ui/Breadcrumbs";
import AccountPlanNotices from "@/components/Layout/AccountPlanNotices";
import { PayloadSizeTopNavNotice } from "@/components/Features/SDKConnections/PayloadSizeNotices";
import styles from "./TopNav.module.scss";
import { usePageHead } from "./PageHead";
import HeaderBreadcrumb from "./HeaderBreadcrumb";
import ProfileMenu from "./ProfileMenu";
import GrowthBotButton from "./GrowthBotButton";

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
            <GrowthBotButton />
            {/* Pages without the side nav (LayoutLite) keep the avatar here. */}
            {toggleLeftMenu ? null : <ProfileMenu />}
          </div>
        </div>
      </div>
    </>
  );
};
export default TopNav;
