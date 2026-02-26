import Link from "next/link";
import { useState } from "react";
import clsx from "clsx";
import { useRouter } from "next/router";
import {
  BsFlag,
  BsClipboardCheck,
  BsCodeSlash,
  BsHouse,
  BsSearch,
} from "react-icons/bs";
import { useGrowthBook } from "@growthbook/growthbook-react";
import { Flex } from "@radix-ui/themes";
import { getGrowthBookBuild } from "@/services/env";
import { useUser } from "@/services/UserContext";
import useOrgSettings from "@/hooks/useOrgSettings";
import {
  GBDatabase,
  GBExperiment,
  GBLibrary,
  GBProductAnalytics,
  GBSettings,
} from "@/components/Icons";
import { inferDocUrl } from "@/components/DocLink";
import UpgradeModal from "@/components/Settings/UpgradeModal";
import { AppFeatures } from "@/types/app-features";
import { WhiteButton } from "@/ui/Button";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import ProjectSelector from "./ProjectSelector";
import SidebarLink, { SidebarLinkProps } from "./SidebarLink";
import TopNav from "./TopNav";
import styles from "./Layout.module.scss";
import { usePageHead } from "./PageHead";
import { useSidebarOpen } from "./SidebarOpenProvider";

const navlinks: SidebarLinkProps[] = [
  {
    name: "Home",
    href: "/",
    Icon: BsHouse,
    path: /^$/,
    className: styles.first,
  },
  {
    name: "Features",
    href: "/features",
    Icon: BsFlag,
    path: /^(features)/,
  },
  {
    name: "Experimentation",
    href: "/experiments",
    path: /^(experiments|experiment\/|bandit|namespaces|power-calculator)/,
    Icon: GBExperiment,
    navigateOnExpand: true,
    subLinks: [
      {
        name: "Experiments",
        href: "/experiments",
        path: /^(experiments(\/(?!templates|explore)|$)|experiment\/)/,
      },
      {
        name: "Bandits",
        href: "/bandits",
        //Icon: GBBandit,
        path: /^bandit/,
        filter: ({ gb }) => !!gb?.isOn("bandits"),
      },
      {
        name: "Holdouts",
        href: "/holdouts",
        path: /^holdouts/,
        filter: ({ gb }) => !!gb?.isOn("holdouts_feature"),
      },
      {
        name: "Templates",
        href: "/experiments/templates",
        path: /^experiments\/templates/,
      },
      {
        name: "Power Calculator",
        href: "/power-calculator",
        path: /^power-calculator/,
      },
      {
        name: "Namespaces",
        href: "/namespaces",
        path: /^namespaces/,
      },
      // {
      //   name: "Search",
      //   href: "/experiments/explore",
      //   path: /^experiments\/explore/,
      // },
    ],
  },
  {
    name: "Product Analytics",
    href: "/product-analytics/explore",
    path: /^(product-analytics)/,
    Icon: GBProductAnalytics,
    filter: ({ gb }) => !!gb?.isOn("general-dashboards"),
    subLinks: [
      {
        name: "Explore",
        href: "/product-analytics/explore",
        path: /^product-analytics\/explore\//,
      },
      {
        name: "Custom SQL Reports",
        href: "/sql-explorer",
        path: /^sql-explorer/,
      },
      {
        name: "Dashboards",
        href: "/product-analytics/dashboards",
        path: /^product-analytics\/dashboards/,
      },
    ],
  },
  {
    name: "Metrics and Data",
    href: "/metrics",
    path: /^(metric\/|metrics|segment|dimension|datasources|fact-|metric-group|sql-explorer)/,
    autoClose: true,
    Icon: GBDatabase,
    subLinks: [
      {
        name: "Metrics",
        href: "/metrics",
        path: /^(metric\/|metrics|fact-metric|metric-group)/,
      },
      {
        name: "Fact Tables",
        href: "/fact-tables",
        path: /^fact-tables/,
      },
      {
        name: "Segments",
        href: "/segments",
        path: /^segment/,
        filter: ({ segments }) => segments.length > 0,
      },
      {
        name: "Dimensions",
        href: "/dimensions",
        path: /^dimension/,
      },
      {
        name: "Data Sources",
        href: "/datasources",
        path: /^datasources/,
      },
    ],
  },
  {
    name: "Insights",
    href: "/dashboard",
    Icon: GBLibrary,
    path: /^(dashboard|learnings|timeline|metric-effect|correlations|presentation)/,
    subLinks: [
      {
        name: "Dashboard",
        href: "/dashboard",
        path: /^dashboard/,
      },
      {
        name: "Learnings",
        href: "/learnings",
        path: /^learnings/,
      },
      {
        name: "Timeline",
        href: "/timeline",
        path: /^(timeline)/,
      },
      // {
      //   name: "Interaction Effects",
      //   href: "/interactions",
      //   path: /^(interaction)/,
      // },
      {
        name: "Metric Effects",
        href: "/metric-effects",
        path: /^(metric-effect)/,
      },
      {
        name: "Metric Correlations",
        href: "/correlations",
        path: /^(correlations)/,
      },
      {
        name: "Presentations",
        href: "/presentations",
        path: /^presentation/,
      },
    ],
    filter: ({ gb }) => !!gb?.isOn("insights"),
  },
  {
    name: "Management",
    href: "/dashboard",
    Icon: BsClipboardCheck,
    path: /^(dashboard|idea|presentation)/,
    autoClose: true,
    subLinks: [
      {
        name: "Dashboard",
        href: "/dashboard",
        path: /^dashboard/,
      },
      {
        name: "Ideas",
        href: "/ideas",
        path: /^idea/,
      },
      {
        name: "Presentations",
        href: "/presentations",
        path: /^presentation/,
      },
    ],
    filter: ({ gb }) => !gb?.isOn("insights"),
  },
  {
    name: "SDK Configuration",
    href: "/sdks",
    path: /^(attributes|environments|saved-groups|sdks|archetypes)/,
    autoClose: true,
    Icon: BsCodeSlash,
    subLinks: [
      {
        name: "SDK Connections",
        href: "/sdks",
        path: /^sdks/,
      },
      {
        name: "Attributes",
        href: "/attributes",
        path: /^attributes/,
      },
      {
        name: "Environments",
        href: "/environments",
        path: /^environments/,
      },
      {
        name: "Saved Groups",
        href: "/saved-groups",
        path: /^saved-groups/,
      },
      {
        name: "Archetypes",
        href: "/archetypes",
        path: /^archetypes/,
      },
      {
        name: "Exposures Debugger",
        href: "/exposure-debugger",
        path: /^exposure-debugger/,
      },
    ],
  },
  {
    name: "Settings",
    href: "/settings",
    Icon: GBSettings,
    path: /^(settings|admin|projects|integrations)/,
    autoClose: true,
    subLinks: [
      {
        name: "General",
        href: "/settings",
        path: /^settings$/,
        filter: ({ permissionsUtils }) =>
          permissionsUtils.canManageOrgSettings(),
      },
      {
        name: "Members",
        href: "/settings/team",
        path: /^settings\/team/,
        filter: ({ permissionsUtils }) => permissionsUtils.canManageTeam(),
      },
      {
        name: "Tags",
        href: "/settings/tags",
        path: /^settings\/tags/,
        filter: ({ permissionsUtils }) =>
          permissionsUtils.canCreateAndUpdateTag() ||
          permissionsUtils.canDeleteTag(),
      },
      {
        name: "Projects",
        href: "/projects",
        path: /^project/,
        filter: ({ permissionsUtils }) =>
          permissionsUtils.canManageSomeProjects(),
      },
      {
        name: "Custom Fields",
        href: "/settings/customfields",
        path: /^settings\/customfields/,
      },
      {
        name: "API Keys",
        href: "/settings/keys",
        path: /^settings\/keys/,
        filter: ({ permissionsUtils }) =>
          permissionsUtils.canCreateApiKey() ||
          permissionsUtils.canDeleteApiKey(),
      },
      {
        name: "Webhooks",
        href: "/settings/webhooks",
        path: /^settings\/webhooks/,
        filter: ({ permissionsUtils }) =>
          permissionsUtils.canViewEventWebhook(),
      },
      {
        name: "Logs",
        href: "/events",
        path: /^events/,
        filter: ({ permissionsUtils }) => permissionsUtils.canViewAuditLogs(),
      },
      {
        name: "Slack",
        href: "/integrations/slack",
        path: /^integrations\/slack/,
        filter: ({ permissionsUtils, gb }) =>
          permissionsUtils.canManageIntegrations() &&
          !!gb?.isOn("slack-integration"),
      },
      {
        name: "GitHub",
        href: "/integrations/github",
        path: /^integrations\/github/,
        filter: ({ permissionsUtils, gb }) =>
          permissionsUtils.canManageIntegrations() &&
          !!gb?.isOn("github-integration"),
      },
      {
        name: "Import your data",
        href: "/importing",
        path: /^importing/,
        filter: ({ permissionsUtils, gb }) =>
          permissionsUtils.canViewFeatureModal() &&
          permissionsUtils.canCreateEnvironment({
            projects: [],
            id: "",
          }) &&
          permissionsUtils.canCreateProjects() &&
          !!gb?.isOn("import-from-x"),
      },
      {
        name: "Usage",
        href: "/settings/usage",
        path: /^settings\/usage/,
        filter: ({ permissionsUtils, isCloud, gb }) =>
          permissionsUtils.canViewUsage() &&
          isCloud &&
          !!gb?.isOn("cdn-usage-data"),
      },
      {
        name: "Custom Hooks",
        href: "/settings/custom-hooks",
        path: /^settings\/custom-hooks/,
        filter: ({ permissionsUtils, isCloud }) =>
          !isCloud && permissionsUtils.canCreateCustomHook({ projects: [] }),
      },
      {
        name: "Billing",
        href: "/settings/billing",
        path: /^settings\/billing/,
        filter: ({ permissionsUtils }) => permissionsUtils.canManageBilling(),
      },
      {
        name: "Admin",
        href: "/admin",
        path: /^admin/,
        divider: true,
        filter: ({ superAdmin, isMultiOrg }) => superAdmin && isMultiOrg,
      },
    ],
  },
];

const breadcumbLinks = [
  ...navlinks,
  {
    name: "Power Calculator",
    path: /^power-calculator/,
    subLinks: [] as SidebarLinkProps[],
  },
];

const otherPageTitles = [
  {
    path: /^$/,
    title: "Home",
  },
  {
    path: /^activity/,
    title: "Activity Feed",
  },
  {
    path: /^reports/,
    title: "My Reports",
  },
  {
    path: /^account\/personal-access-tokens/,
    title: "Personal Access Tokens",
  },
  {
    path: /^getstarted/,
    title: "Get Started",
  },
  {
    path: /^dashboard/,
    title: "Dashboard",
  },
];

const backgroundShade = (color: string) => {
  // convert to RGB
  // @ts-expect-error TS(2769) If you come across this, please fix it!: No overload matches this call.
  const c = +("0x" + color.slice(1).replace(color.length < 5 && /./g, "$&$&"));
  const r = c >> 16;
  const g = (c >> 8) & 255;
  const b = c & 255;
  // http://alienryderflex.com/hsp.html
  const hsp = Math.sqrt(0.299 * (r * r) + 0.587 * (g * g) + 0.114 * (b * b));
  if (hsp > 127.5) {
    return "light";
  } else {
    return "dark";
  }
};

const Layout = (): React.ReactElement => {
  const { open, setOpen } = useSidebarOpen();
  const settings = useOrgSettings();
  const permissionsUtil = usePermissionsUtil();
  const { organization, canSubscribe } = useUser();
  const growthbook = useGrowthBook<AppFeatures>();

  // holdout aa-test, dogfooding
  growthbook?.isOn("aa-test-holdout");

  const { breadcrumb } = usePageHead();

  const [upgradeModal, setUpgradeModal] = useState(false);
  const showUpgradeButton =
    canSubscribe &&
    permissionsUtil.canManageBilling() &&
    !organization.isVercelIntegration;

  // hacky:
  const router = useRouter();
  const path = router.route.substr(1);
  // don't show the nav for presentations
  if (path.match(/^present\//)) {
    // @ts-expect-error TS(2322) If you come across this, please fix it!: Type 'null' is not assignable to type 'ReactElemen... Remove this comment to see the full error message
    return null;
  }

  let pageTitle = [...breadcrumb]
    .reverse()
    .map((b) => b.display)
    .join(" - ");

  // If no breadcrumb provided, try to figure out a page name based on the path
  otherPageTitles.forEach((o) => {
    if (!pageTitle && o.path.test(path)) {
      pageTitle = o.title;
    }
  });
  breadcumbLinks.forEach((o) => {
    if (o.subLinks) {
      o.subLinks.forEach((s) => {
        if (!pageTitle && s.path.test(path)) {
          pageTitle = s.name;
        }
      });
    }
    if (!pageTitle && o.path.test(path)) {
      pageTitle = o.name;
    }
  });

  let customStyles = ``;
  if (settings?.customized) {
    const textColor =
      // @ts-expect-error TS(2345) If you come across this, please fix it!: Argument of type 'string | undefined' is not assig... Remove this comment to see the full error message
      backgroundShade(settings?.primaryColor) === "dark" ? "#fff" : "#444";

    // we could support saving this CSS in the settings so it can be customized
    customStyles = `
      .sidebar { background-color: ${settings.primaryColor} !important; transition: none }
      .sidebarlink { transition: none; } 
      .sidebarlink:hover {
        background-color: background-color: ${settings.secondaryColor} !important;
      }
      .sidebarlink a:hover, .sidebarlink.selected, .sublink.selected { background-color: ${settings.secondaryColor} !important; } 
      .sublink {border-color: ${settings.secondaryColor} !important; }
      .sublink:hover, .sublink:hover a { background-color: ${settings.secondaryColor} !important; }
      .sidebarlink a, .sublink a {color: ${textColor}}
      `;
  }

  const build = getGrowthBookBuild();

  return (
    <>
      {upgradeModal && (
        <UpgradeModal
          close={() => setUpgradeModal(false)}
          source="layout"
          commercialFeature={null}
        />
      )}
      {settings?.customized && (
        <style dangerouslySetInnerHTML={{ __html: customStyles }}></style>
      )}
      <div
        className={clsx(styles.sidebar, "sidebar mb-5", {
          [styles.sidebaropen]: open,
        })}
      >
        <div className="">
          <div className="app-sidebar-header">
            <div className="app-sidebar-logo">
              <Link
                href="/"
                aria-current="page"
                className="app-sidebar-logo active"
                title="GrowthBook Home"
                onClick={() => setOpen(false)}
              >
                <div className={styles.sidebarlogo}>
                  {settings?.customized && settings?.logoPath ? (
                    <>
                      <img
                        className={styles.userlogo}
                        alt="GrowthBook"
                        src={settings.logoPath}
                      />
                    </>
                  ) : (
                    <>
                      <img
                        className={styles.logo}
                        alt="GrowthBook"
                        src="/logo/growth-book-logomark-white.svg"
                      />
                      <img
                        className={styles.logotext}
                        alt="GrowthBook"
                        src="/logo/growth-book-name-white.svg"
                      />
                    </>
                  )}
                </div>
              </Link>
            </div>
            <div className={styles.mainmenu}>
              <ul
                onClick={(e) => {
                  const t = (e.target as HTMLElement).closest("a");
                  if (t && t.href && !t.className.match(/no-close/)) {
                    setOpen(false);
                  }
                }}
              >
                <li>
                  <a
                    href="#"
                    className={`${styles.closebutton} closebutton`}
                    onClick={(e) => e.preventDefault()}
                  >
                    <svg
                      className="bi bi-x"
                      width="1.9em"
                      height="1.9em"
                      viewBox="0 0 16 16"
                      fill="currentColor"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path
                        fillRule="evenodd"
                        d="M11.854 4.146a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708-.708l7-7a.5.5 0 0 1 .708 0z"
                      />
                      <path
                        fillRule="evenodd"
                        d="M4.146 4.146a.5.5 0 0 0 0 .708l7 7a.5.5 0 0 0 .708-.708l-7-7a.5.5 0 0 0-.708 0z"
                      />
                    </svg>
                  </a>
                </li>
                <li>
                  <button
                    className={styles.searchTrigger}
                    onClick={() => {
                      document.dispatchEvent(new Event("open-command-palette"));
                    }}
                  >
                    <BsSearch size={13} />
                    <span className={styles.searchTriggerLabel}>Search</span>
                    <span className={styles.searchTriggerKbd}>
                      {typeof navigator !== "undefined" &&
                      /Mac|iPhone|iPad/.test(navigator.userAgent)
                        ? "\u2318 K"
                        : "Ctrl+K"}
                    </span>
                  </button>
                </li>
                <ProjectSelector />
                {navlinks.map((v, i) => (
                  <SidebarLink {...v} key={i} />
                ))}
              </ul>
            </div>
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <Flex p="3" direction="column" gap="4">
          {showUpgradeButton && (
            <WhiteButton onClick={() => setUpgradeModal(true)}>
              <>Upgrade</>
            </WhiteButton>
          )}
          <a href={inferDocUrl()} target="_blank" rel="noreferrer">
            <WhiteButton variant="outline">View docs</WhiteButton>
          </a>
        </Flex>
        {build.sha && (
          <div className="px-3 my-1 text-center">
            <small>
              <span className="text-muted">Build:</span>{" "}
              <a
                href={`https://github.com/growthbook/growthbook/commit/${build.sha}`}
                target="_blank"
                rel="noreferrer"
                className="text-white"
              >
                {build.lastVersion}+{build.sha.substr(0, 7)}
              </a>{" "}
              {build.date && (
                <span className="text-muted">({build.date.substr(0, 10)})</span>
              )}
            </small>
          </div>
        )}
      </div>

      <TopNav
        pageTitle={pageTitle}
        showNotices={true}
        toggleLeftMenu={() => setOpen(!open)}
      />
    </>
  );
};

export default Layout;
