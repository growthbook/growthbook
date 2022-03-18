import Link from "next/link";
import styles from "./Layout.module.scss";
import { useState } from "react";
import clsx from "clsx";
import { useRouter } from "next/router";
import TopNav from "./TopNav";
import { FaArrowRight } from "react-icons/fa";
import { GBExperiment, GBSettings } from "../Icons";
import SidebarLink, { SidebarLinkProps } from "./SidebarLink";
import ProjectSelector from "./ProjectSelector";
import { BsFlag, BsClipboardCheck } from "react-icons/bs";
import { getGrowthBookBuild } from "../../services/env";
import useOrgSettings from "../../hooks/useOrgSettings";

// move experiments inside of 'analysis' menu
const navlinks: SidebarLinkProps[] = [
  {
    name: "Features",
    href: "/features",
    Icon: BsFlag,
    path: /^features/,
    beta: false,
    className: styles.first,
  },
  {
    name: "Analysis",
    href: "/experiments",
    Icon: GBExperiment,
    path: /^(experiment|metric|segment|dimension|datasources)/,
    autoClose: true,
    subLinks: [
      {
        name: "Experiments",
        href: "/experiments",
        path: /^experiment/,
      },
      {
        name: "Metrics",
        href: "/metrics",
        path: /^metric/,
      },
      {
        name: "Segments",
        href: "/segments",
        path: /^segment/,
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
    name: "Management",
    href: "/dashboard",
    Icon: BsClipboardCheck,
    path: /^(dashboard|idea|presentation|projects|namespaces)/,
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
      {
        name: "Projects",
        href: "/projects",
        path: /^projects/,
      },
      {
        name: "Namespaces",
        href: "/namespaces",
        path: /^namespaces/,
      },
    ],
  },
  {
    name: "Settings",
    href: "/settings",
    Icon: GBSettings,
    path: /^(settings|admin)/,
    settingsPermission: true,
    autoClose: true,
    subLinks: [
      {
        name: "General",
        href: "/settings",
        path: /^settings$/,
      },
      {
        name: "Team",
        href: "/settings/team",
        path: /^settings\/team/,
      },
      {
        name: "Attributes",
        href: "/settings/attributes",
        path: /^settings\/attributes/,
      },
      {
        name: "Billing",
        href: "/settings/billing",
        path: /^settings\/billing/,
        cloudOnly: true,
      },
      {
        name: "API Keys",
        href: "/settings/keys",
        path: /^settings\/keys/,
      },
      {
        name: "Webhooks",
        href: "/settings/webhooks",
        path: /^settings\/webhooks/,
      },
      {
        name: "Admin",
        href: "/admin",
        path: /^admin/,
        cloudOnly: true,
        divider: true,
        superAdmin: true,
      },
    ],
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
    path: /^experiments\/designer/,
    title: "Visual Experiment Designer",
  },
  {
    path: /^getstarted/,
    title: "Get Started",
  },
  {
    path: /^dashboard/,
    title: "Program Management",
  },
];

const backgroundShade = (color: string) => {
  // convert to RGB
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

  // hacky:
  const router = useRouter();
  const path = router.route.substr(1);
  // don't show the nav for presentations
  if (path.match(/^present\//)) {
    return null;
  }

  let pageTitle: string;
  otherPageTitles.forEach((o) => {
    if (!pageTitle && o.path.test(path)) {
      pageTitle = o.title;
    }
  });
  navlinks.forEach((o) => {
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
              <Link href="/">
                <a
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
                </a>
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
          <a
            href="https://docs.growthbook.io"
            className="btn btn-outline-light btn-block"
            target="_blank"
            rel="noreferrer"
          >
            View Docs <FaArrowRight className="ml-2" />
          </a>
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
                {build.sha.substr(0, 7)}
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
