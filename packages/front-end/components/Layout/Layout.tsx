import Link from "next/link";
import styles from "./Layout.module.scss";
import { useState, useContext } from "react";
import clsx from "clsx";
import { useRouter } from "next/router";
import TopNav from "./TopNav";
import {
  FaBook,
  FaUserLock,
  FaUsers,
  FaChartLine,
  FaShapes,
  FaKey,
  FaDatabase,
  FaCreditCard,
  FaBookOpen,
  FaArrowRight,
  FaBolt,
  FaFolder,
} from "react-icons/fa";
import SidebarLink, { SidebarLinkProps } from "./SidebarLink";
import { BsGear } from "react-icons/bs";
import { GoSettings } from "react-icons/go";
import { UserContext } from "../ProtectedPage";
import { useDefinitions } from "../../services/DefinitionsContext";

const navlinks: SidebarLinkProps[] = [
  {
    name: "Ideas",
    href: "/ideas",
    icon: "ideas.svg",
    path: /^idea/,
  },
  {
    name: "Experiments",
    href: "/experiments",
    icon: "experiments.svg",
    path: /^experiment/,
  },
  {
    name: "Presentations",
    href: "/presentations",
    icon: "present.svg",
    path: /^presentations/,
  },
  {
    name: "Definitions",
    href: "/metrics",
    Icon: FaBook,
    divider: true,
    path: /^(metric|segment|dimension)/,
    subLinks: [
      {
        name: "Metrics",
        href: "/metrics",
        Icon: FaChartLine,
        path: /^metric/,
      },
      {
        name: "Segments",
        href: "/segments",
        Icon: FaUsers,
        path: /^segment/,
      },
      {
        name: "Dimensions",
        href: "/dimensions",
        Icon: FaShapes,
        path: /^dimension/,
      },
    ],
  },
  {
    name: "Settings",
    href: "/settings",
    Icon: BsGear,
    divider: true,
    path: /^(settings|admin|datasources)/,
    settingsPermission: true,
    autoClose: true,
    subLinks: [
      {
        name: "General",
        href: "/settings",
        Icon: GoSettings,
        path: /^settings$/,
      },
      {
        name: "Team",
        href: "/settings/team",
        Icon: FaUsers,
        path: /^settings\/team/,
      },
      {
        name: "Projects",
        href: "/settings/projects",
        Icon: FaFolder,
        path: /^settings\/projects/,
      },
      {
        name: "Billing",
        href: "/settings/billing",
        Icon: FaCreditCard,
        path: /^settings\/billing/,
        cloudOnly: true,
      },
      {
        name: "API Keys",
        href: "/settings/keys",
        Icon: FaKey,
        path: /^settings\/keys/,
      },
      {
        name: "Webhooks",
        href: "/settings/webhooks",
        Icon: FaBolt,
        path: /^settings\/webhooks/,
      },
      {
        name: "Data Sources",
        href: "/datasources",
        Icon: FaDatabase,
        path: /^datasources/,
      },
      {
        name: "Admin",
        href: "/admin",
        Icon: FaUserLock,
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
    path: /^activity/,
    title: "Activity Feed",
  },
  {
    path: /^experiments\/designer/,
    title: "Visual Experiment Designer",
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
  const { settings } = useContext(UserContext);
  const { project, projects, setProject } = useDefinitions();

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
        if (s.path.test(path)) {
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
                  title="Growth Book Home"
                  onClick={() => setOpen(false)}
                >
                  <div className={styles.sidebarlogo}>
                    {settings?.customized && settings?.logoPath ? (
                      <>
                        <img
                          className={styles.userlogo}
                          alt="Growth Book"
                          src={settings.logoPath}
                        />
                      </>
                    ) : (
                      <>
                        <img
                          className={styles.logo}
                          alt="Growth Book"
                          src="/logo/growth-book-logomark-white.svg"
                        />
                        <img
                          className={styles.logotext}
                          alt="Growth Book"
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
                {projects.length > 0 && (
                  <li className="px-3">
                    <select
                      className="form-control"
                      value={project}
                      onChange={(e) => {
                        setProject(e.target.value);
                      }}
                    >
                      <option value="">All Projects</option>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </li>
                )}
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
            <FaBookOpen className="mr-2" /> View Docs{" "}
            <FaArrowRight className="ml-2" />
          </a>
        </div>
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
