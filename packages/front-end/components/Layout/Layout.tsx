import { useRouter } from "next/router";
import useMediaQuery from "@/hooks/useMediaQuery";
import { isSettingsRoute, navlinks } from "./sidebarNav";
import TopNav from "./TopNav";
import Sidebar from "./Sidebar";
import { usePageHead } from "./PageHead";
import { useSidebarOpen } from "./SidebarOpenProvider";
import SettingsNav from "./SettingsNav";
import { SETTINGS_NAV_MIN_WIDTH_PX } from "./constants";

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
    path: /^account\/slack/,
    title: "My Slack Links",
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

const Layout = (): React.ReactElement => {
  const { open, setOpen } = useSidebarOpen();
  const { breadcrumb } = usePageHead();
  // Narrower, the Settings nav is a select at the page's top
  // (SettingsPageTop).
  const settingsNarrow = useMediaQuery(
    `(max-width: ${SETTINGS_NAV_MIN_WIDTH_PX - 1}px)`,
  );

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

  const inSettings = isSettingsRoute(router.route);

  return (
    <>
      <Sidebar />
      {inSettings && !settingsNarrow ? <SettingsNav /> : null}
      <TopNav
        pageTitle={pageTitle}
        showNotices={true}
        toggleLeftMenu={() => setOpen(!open)}
        menuOpen={open}
      />
    </>
  );
};

export default Layout;
