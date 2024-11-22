import Link from "next/link";
import { useState } from "react";
import clsx from "clsx";
import { useRouter } from "next/router";
import {
  BsFlag,
  BsClipboardCheck,
  BsLightbulb,
  BsCodeSlash,
} from "react-icons/bs";
import { FaArrowRight } from "react-icons/fa";
import { useGrowthBook } from "@growthbook/growthbook-react";
import { getGrowthBookBuild } from "@/services/env";
import { useUser } from "@/services/UserContext";
import useStripeSubscription from "@/hooks/useStripeSubscription";
import useOrgSettings from "@/hooks/useOrgSettings";
import {
  GBBandit,
  GBDatabase,
  GBExperiment,
  GBPremiumBadge,
  GBSettings,
} from "@/components/Icons";
import { inferDocUrl } from "@/components/DocLink";
import UpgradeModal from "@/components/Settings/UpgradeModal";
import { AppFeatures } from "@/types/app-features";
import ProjectSelector from "./ProjectSelector";
import SidebarLink, { SidebarLinkProps } from "./SidebarLink";
import TopNav from "./TopNav";
import styles from "./Layout.module.scss";
import { usePageHead } from "./PageHead";

// 将侧边栏链接属性数组中的英文名称替换为中文
const navlinks: SidebarLinkProps[] = [
  {
    name: "开始使用",
    href: "/getstarted",
    Icon: BsLightbulb,
    path: /^getstarted/,
    className: styles.first,
  },
  {
    name: "A/B实验",
    href: "/experiments",
    path: /^experiment/,
    Icon: GBExperiment,
  },
  {
    name: "Feature",
    href: "/features",
    Icon: BsFlag,
    path: /^features/,
  },
  // {
  //   name: "多臂老虎机",
  //   href: "/bandits",
  //   Icon: GBBandit,
  //   path: /^bandit/,
  //   beta: true,
  //   filter: ({ gb }) => !!gb?.isOn("bandits"),
  // },
  {
    name: "指标和数据",
    href: "/metrics",
    path: /^(metric|segment|dimension|datasources|fact-|metric-group)/,
    autoClose: true,
    Icon: GBDatabase,
    subLinks: [
      {
        name: "指标",
        href: "/metrics",
        path: /^(metric$|metrics|fact-metric|metric-group)/,
      },
      {
        name: "事实表",
        href: "/fact-tables",
        path: /^fact-tables/,
      },
      // {
      //   name: "Segments",
      //   href: "/segments",
      //   path: /^segment/,
      // },
      // {
      //   name: "维度",
      //   href: "/dimensions",
      //   path: /^dimension/,
      // },
      {
        name: "数据源",
        href: "/datasources",
        path: /^datasources/,
      },
    ],
  },
  // {
  //   name: "管理",
  //   href: "/dashboard",
  //   Icon: BsClipboardCheck,
  //   path: /^(dashboard|idea|presentation)/,
  //   autoClose: true,
  //   subLinks: [
  //     {
  //       name: "仪表盘",
  //       href: "/dashboard",
  //       path: /^dashboard/,
  //     },
  //     {
  //       name: "想法",
  //       href: "/ideas",
  //       path: /^idea/,
  //     },
  //     {
  //       name: "展示",
  //       href: "/presentations",
  //       path: /^presentation/,
  //     },
  //   ],
  // },
  {
    name: "SDK配置",
    href: "/sdks",
    path: /^(attributes|namespaces|environments|saved-groups|sdks)/,
    autoClose: true,
    Icon: BsCodeSlash,
    subLinks: [
      {
        name: "SDK连接",
        href: "/sdks",
        path: /^sdks/,
      },
      {
        name: "属性",
        href: "/attributes",
        path: /^attributes/,
      },
      // {
      //   name: "命名空间",
      //   href: "/namespaces",
      //   path: /^namespaces/,
      // },
      {
        name: "环境",
        href: "/environments",
        path: /^environments/,
      },
      // {
      //   name: "已保存组",
      //   href: "/saved-groups",
      //   path: /^saved-groups/,
      // },
    ],
  },
  {
    name: "设置",
    href: "/settings",
    Icon: GBSettings,
    path: /^(settings|admin|projects|integrations)/,
    autoClose: true,
    subLinks: [
      {
        name: "常规",
        href: "/settings",
        path: /^settings$/,
        filter: ({ permissionsUtils }) =>
          permissionsUtils.canManageOrgSettings(),
      },
      {
        name: "成员",
        href: "/settings/team",
        path: /^settings\/team/,
        filter: ({ permissionsUtils }) => permissionsUtils.canManageTeam(),
      },
      {
        name: "标签",
        href: "/settings/tags",
        path: /^settings\/tags/,
        filter: ({ permissionsUtils }) =>
          permissionsUtils.canCreateAndUpdateTag() ||
          permissionsUtils.canDeleteTag(),
      },
      {
        name: "项目",
        href: "/projects",
        path: /^project/,
        filter: ({ permissionsUtils }) =>
          permissionsUtils.canManageSomeProjects(),
      },
      {
        name: "API密钥",
        href: "/settings/keys",
        path: /^settings\/keys/,
        filter: ({ permissionsUtils }) =>
          permissionsUtils.canCreateApiKey() ||
          permissionsUtils.canDeleteApiKey(),
      },
      // {
      //   name: "Webhooks",
      //   href: "/settings/webhooks",
      //   path: /^settings\/webhooks/,
      //   filter: ({ permissionsUtils }) =>
      //     permissionsUtils.canViewEventWebhook(),
      // },
      {
        name: "日志",
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
      // {
      //   name: "GitHub",
      //   href: "/integrations/github",
      //   path: /^integrations\/github/,
      //   filter: ({ permissionsUtils, gb }) =>
      //     permissionsUtils.canManageIntegrations() &&
      //     !!gb?.isOn("github-integration"),
      // },
      // {
      //   name: "导入您的数据",
      //   href: "/importing",
      //   path: /^importing/,
      //   filter: ({ permissionsUtils, gb }) =>
      //     permissionsUtils.canViewFeatureModal() &&
      //     permissionsUtils.canCreateEnvironment({
      //       projects: [],
      //       id: "",
      //     }) &&
      //     permissionsUtils.canCreateProjects() &&
      //     !!gb?.isOn("import-from-x"),
      // },
      // {
      //   name: "计费",
      //   href: "/settings/billing",
      //   path: /^settings\/billing/,
      //   filter: ({ permissionsUtils }) => permissionsUtils.canManageBilling(),
      // },
      {
        name: "管理员",
        href: "/admin",
        path: /^admin/,
        divider: true,
        filter: ({ superAdmin, isMultiOrg }) => superAdmin && isMultiOrg,
      },
    ],
  },
];

// 将面包屑链接数组中的英文名称替换为中文
const breadcumbLinks = [
  ...navlinks,
  {
    name: "功效计算器",
    path: /^power-calculator/,
    subLinks: [] as SidebarLinkProps[],
  },
];

// 将其他页面标题数组中的英文名称替换为中文
const otherPageTitles = [
  {
    path: /^$/,
    title: "首页",
  },
  {
    path: /^activity/,
    title: "活动动态",
  },
  {
    path: /^integrations\/vercel/,
    title: "Vercel集成",
  },
  {
    path: /^integrations\/vercel\/configure/,
    title: "Vercel集成配置",
  },
  {
    path: /^getstarted/,
    title: "开始使用",
  },
  {
    path: /^dashboard/,
    title: "项目管理",
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
  const [open, setOpen] = useState(false);
  const settings = useOrgSettings();
  const { accountPlan, license } = useUser();
  const { hasPaymentMethod } = useStripeSubscription();
  const growthbook = useGrowthBook<AppFeatures>();

  // app wide a-a tests
  growthbook?.isOn("gb-ax5-bandit");
  growthbook?.isOn("gb-ax10-bandit");

  const { breadcrumb } = usePageHead();

  const [upgradeModal, setUpgradeModal] = useState(false);
  // const showUpgradeButton =
  //   ["oss", "starter"].includes(accountPlan || "") ||
  //   (license?.isTrial &&!hasPaymentMethod) ||
  //   (["pro", "pro_sso"].includes(accountPlan || "") &&
  //     license?.stripeSubscription?.status === "canceled");
  const showUpgradeButton = false;
  const showViewDocsButton = false;

  // hacky:
  const router = useRouter();
  const path = router.route.substr(1);
  // don't show the nav for presentations
  if (path.match(/^present\//)) {
    // @ts-expect-error TS(2322) If you come across this, please fix it!: Type 'null' is not assignable to type 'ReactElemen... Remove this comment to see the full error message
    return null;
  }

  let pageTitle = breadcrumb.map((b) => b.display).join(" > ");

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
     .sidebar { background-color: ${settings.primaryColor}!important; transition: none }
     .sidebarlink { transition: none; }
     .sidebarlink:hover {
        background-color: background-color: ${settings.secondaryColor}!important;
      }
     .sidebarlink a:hover,.sidebarlink.selected,.sublink.selected { background-color: ${settings.secondaryColor}!important; }
     .sublink {border-color: ${settings.secondaryColor}!important; }
     .sublink:hover,.sublink:hover a { background-color: ${settings.secondaryColor}!important; }
     .sidebarlink a,.sublink a {color: ${textColor}}
      `;
  }

  const build = getGrowthBookBuild();

  return (
    <>
      {upgradeModal && (
        <UpgradeModal
          close={() => setUpgradeModal(false)}
          reason=""
          source="layout"
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
                title="GrowthBook首页"
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
                        d="M11.854 4.146a.5.5 0 0 1 0.708l-7 7a.5.5 0 0 1-.708-.708l7-7a.5.5 0 0 1.708 0z"
                      />
                      <path
                        fillRule="evenodd"
                        d="M4.146 4.146a.5.5 0 0 0 0.708l7 7a.5.5 0 0 0.708-.708l-7-7a.5.5 0 0 0-.708 0z"
                      />
                    </svg>
                  </a>
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
        <div className="p-3">
          {showUpgradeButton && (
            <button
              className="btn btn-premium btn-block font-weight-normal"
              onClick={() => setUpgradeModal(true)}
            >
              <>
                升级 <GBPremiumBadge />
              </>
            </button>
          )}

          {showViewDocsButton && (<a
            href={inferDocUrl()}
            className="btn btn-outline-light btn-block"
            target="_blank"
            rel="noreferrer"
          >
            查看文档 <FaArrowRight className="ml-2" />
          </a>)}

        </div>
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
