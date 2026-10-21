import { FC } from "react";
import clsx from "clsx";
import { PiList, PiSparkle } from "react-icons/pi";
import { IconButton } from "@radix-ui/themes";
import Head from "next/head";
import Breadcrumbs from "@/ui/Breadcrumbs";
import NoticeStack from "@/components/Notices/NoticeStack";
import useAccountPlanNotices from "@/components/Notices/useAccountPlanNotices";
import useKeyExpiryNotices from "@/components/Notices/useKeyExpiryNotices";
import { usePayloadSizeNotices } from "@/components/Features/SDKConnections/PayloadSizeNotices";
import { useAgentPanel } from "@/components/Agent/AgentPanelContext";
import styles from "./TopNav.module.scss";
import { usePageHead } from "./PageHead";
import HeaderBreadcrumb from "./HeaderBreadcrumb";
import ProfileMenu from "./ProfileMenu";

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
  const notices = [
    ...useAccountPlanNotices(),
    ...usePayloadSizeNotices(),
    ...useKeyExpiryNotices(),
  ];

  const {
    available: agentAvailable,
    open: agentOpen,
    togglePanel: toggleAgentPanel,
  } = useAgentPanel();

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
            {agentAvailable && (
              <button
                type="button"
                onClick={toggleAgentPanel}
                aria-label={
                  agentOpen
                    ? "Close GrowthBook AI assistant"
                    : "Open GrowthBook AI assistant"
                }
                aria-pressed={agentOpen}
                title="Ask GrowthBook AI"
                className={`nav-link ${styles.agentTrigger} ${
                  agentOpen ? styles.agentTriggerActive : ""
                }`}
              >
                <PiSparkle size={18} />
              </button>
            )}
          </div>
          {/* With the side nav, the profile menu is in it. */}
          {toggleLeftMenu ? null : <ProfileMenu />}
        </div>
      </div>
    </>
  );
};
export default TopNav;
