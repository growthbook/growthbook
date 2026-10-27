import { FC, useEffect, useState } from "react";
import clsx from "clsx";
import { PiList } from "react-icons/pi";
import { IconButton } from "@radix-ui/themes";
import Head from "next/head";
import Breadcrumbs from "@/ui/Breadcrumbs";
import NoticeStack from "@/components/Notices/NoticeStack";
import useAccountPlanNotices from "@/components/Notices/useAccountPlanNotices";
import useKeyExpiryNotices from "@/components/Notices/useKeyExpiryNotices";
import { usePayloadSizeNotices } from "@/components/Features/SDKConnections/PayloadSizeNotices";
import styles from "./TopNav.module.scss";
import { usePageHead } from "./PageHead";
import HeaderBreadcrumb from "./HeaderBreadcrumb";
import ProfileMenu from "./ProfileMenu";
import HelpMenu from "./HelpMenu";
import GrowthBotButton from "./GrowthBotButton";

const TopNav: FC<{
  toggleLeftMenu?: () => void;
  // Whether the side nav's drawer (below 1180px) is open.
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
  const { breadcrumb } = usePageHead();
  // The header's fade shows once the page has scrolled under it.
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 0);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);
  const notices = [
    ...useAccountPlanNotices(),
    ...usePayloadSizeNotices(),
    ...useKeyExpiryNotices(),
  ];

  const renderTitleOrBreadCrumb = () => {
    const breadcrumbItems =
      breadcrumb.length > 0 ? breadcrumb : [{ display: pageTitle }];

    return (
      <div className={styles.pagetitle}>
        {toggleLeftMenu ? (
          <HeaderBreadcrumb />
        ) : (
          <Breadcrumbs items={breadcrumbItems} />
        )}
      </div>
    );
  };

  return (
    <>
      <Head>
        <title>{pageTitle ? `${pageTitle} | GrowthBook` : "GrowthBook"}</title>
      </Head>
      <div
        className={`navbar ${styles.topbar} mb-2 position-fixed`}
        style={{
          left: toggleLeftMenu ? undefined : 0,
        }}
      >
        <div className={clsx(styles.navbar, toggleLeftMenu && styles.withMenu)}>
          {toggleLeftMenu ? (
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
          {renderTitleOrBreadCrumb()}
          {/* Beside the title, or its own row's right end below 1180px. */}
          <div className={styles.actions}>
            {showNotices && (
              <div className="nav-link">
                <NoticeStack notices={notices} />
              </div>
            )}
            <GrowthBotButton />
          </div>
          {/* With the side nav, Help and the profile menu are in it. */}
          {toggleLeftMenu ? null : (
            <>
              <HelpMenu />
              <ProfileMenu />
            </>
          )}
        </div>
      </div>
      {/* Outside the header, so whatever pins under it covers the fade. */}
      <div
        aria-hidden="true"
        className={clsx(styles.headerFade, scrolled && styles.scrolled)}
        style={{
          left: toggleLeftMenu ? undefined : 0,
        }}
      />
    </>
  );
};
export default TopNav;
