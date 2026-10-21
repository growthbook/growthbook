import { FC } from "react";
import { FaBars } from "react-icons/fa";
import { PiSparkle } from "react-icons/pi";
import Head from "next/head";
import Breadcrumbs from "@/ui/Breadcrumbs";
import NoticeStack from "@/components/Notices/NoticeStack";
import useAccountPlanNotices from "@/components/Notices/useAccountPlanNotices";
import useKeyExpiryNotices from "@/components/Notices/useKeyExpiryNotices";
import { usePayloadSizeNotices } from "@/components/Features/SDKConnections/PayloadSizeNotices";
import AccountPlanBadge from "@/components/Layout/AccountPlanBadge";
import { useAgentPanel } from "@/components/Agent/AgentPanelContext";
import styles from "./TopNav.module.scss";
import { usePageHead } from "./PageHead";
import HeaderBreadcrumb from "./HeaderBreadcrumb";
import ProfileMenu from "./ProfileMenu";

const TopNav: FC<{
  toggleLeftMenu?: () => void;
  pageTitle: string;
  showNotices?: boolean;
  showLogo?: boolean;
}> = ({ toggleLeftMenu, pageTitle, showNotices, showLogo = true }) => {
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
          {renderTitleOrBreadCrumb()}
          {showNotices && (
            <>
              <div className="nav-link">
                <NoticeStack notices={notices} />
              </div>
              <div className="nav-link">
                <AccountPlanBadge />
              </div>
            </>
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
          {/* With the side nav, the profile menu is in it. */}
          {toggleLeftMenu ? null : <ProfileMenu />}
        </div>
      </div>
    </>
  );
};
export default TopNav;
