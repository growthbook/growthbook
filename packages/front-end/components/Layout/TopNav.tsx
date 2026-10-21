import { FC, useEffect, useState } from "react";
import { PiList } from "react-icons/pi";
import { IconButton } from "@radix-ui/themes";
import Head from "next/head";
import Breadcrumbs from "@/ui/Breadcrumbs";
import NoticeBanner from "@/components/Notices/NoticeBanner";
import NoticeStack from "@/components/Notices/NoticeStack";
import noticeStyles from "@/components/Notices/HeaderNotices.module.scss";
import NoticeIndicator from "@/components/Notices/NoticeIndicator";
import {
  dismissBanner,
  routeHeaderNotices,
  useDismissedBanner,
} from "@/components/Notices/headerNotices";
import { useNoticeAction } from "@/components/Notices/NoticeListItem";
import useAccountPlanNotices from "@/components/Notices/useAccountPlanNotices";
import useKeyExpiryNotices from "@/components/Notices/useKeyExpiryNotices";
import { usePayloadSizeNotices } from "@/components/Features/SDKConnections/PayloadSizeNotices";
import styles from "./TopNav.module.scss";
import { usePageHead } from "./PageHead";
import HeaderBreadcrumb from "./HeaderBreadcrumb";
import ProfileMenu from "./ProfileMenu";
import GrowthBotButton from "./GrowthBotButton";
import { usePrototypeCurrentHeaderNotices } from "./PrototypeControls";

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
  // Whether the side nav's drawer (below 1180px) is open, for its menu
  // button's state.
  menuOpen?: boolean;
  pageTitle: string;
  showNotices?: boolean;
  showLogo?: boolean;
}> = ({
  toggleLeftMenu,
  menuOpen,
  pageTitle,
  showNotices,
  showLogo = true,
}) => {
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
  // As main's TopNav (set in review), then split into the banner, the
  // warnings badge and the trial's pill (PROTOTYPE, set in review;
  // headerNotices.ts).
  // The banner goes to one the viewer can act on, within a level.
  const getNoticeAction = useNoticeAction();
  // And the banner this viewer closed this session (set in review).
  const dismissedBanner = useDismissedBanner();
  const allNotices = [
    ...useAccountPlanNotices(),
    ...usePayloadSizeNotices(),
    ...useKeyExpiryNotices(),
  ];
  // PROTOTYPE ("Current product treatment", set in review): as the product
  // shows them today, main's NoticeStack, with no banner or badge.
  const currentTreatment = usePrototypeCurrentHeaderNotices();
  const notices = routeHeaderNotices(
    allNotices,
    (notice) => getNoticeAction(notice) !== null,
    dismissedBanner,
  );
  const { banner } = notices;

  return (
    <>
      <Head>
        <title>{pageTitle ? `${pageTitle} | GrowthBook` : "GrowthBook"}</title>
      </Head>
      {/* PROTOTYPE: errors, in a full-width banner above the header. */}
      {showNotices && !currentTreatment && (
        <NoticeBanner
          notice={banner}
          more={notices.bannerMore}
          onDismiss={
            banner && notices.bannerDismissible
              ? () => dismissBanner(banner)
              : undefined
          }
        />
      )}
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
            // Below 1180px, opens the side nav's drawer: a plain icon button
            // in the side nav's icon grey and size (set in review; was a
            // heavy purple bars icon).
            <IconButton
              variant="ghost"
              color="gray"
              size="2"
              id="main-menu-toggle"
              className={styles.mobilemenu}
              aria-label="Open main menu"
              aria-controls="main-menu"
              aria-expanded={!!menuOpen}
              onClick={toggleLeftMenu}
            >
              <PiList size={18} />
            </IconButton>
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
            {/* The header's notices, from main's notice system (set in
              review; were AccountPlanNotices and PayloadSizeTopNavNotice).
              PROTOTYPE (set in review; was main's NoticeStack, the top
              notice as a pill and the rest behind "+N"): the warnings
              badge, and before it the trial's countdown as the product's
              pill (main's NoticeStack, set in review; tried the banner and
              a chip); the top error is in the banner above, the others
              behind its "+N" chip. The
              prototype panel's Header notices can switch on fake ones
              (prototypeNotices.ts). */}
            {showNotices &&
              (currentTreatment ? (
                <div className={`nav-link ${noticeStyles.currentStack}`}>
                  <NoticeStack notices={allNotices} />
                </div>
              ) : (
                <>
                  {notices.trial ? (
                    <div className={noticeStyles.trialPill}>
                      <NoticeStack notices={[notices.trial]} />
                    </div>
                  ) : null}
                  <NoticeIndicator notices={notices.list} />
                </>
              ))}
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
