import { useRouter } from "next/router";
import { SidebarLinkProps } from "./SidebarLink";
import { navlinks } from "./sidebarNav";
import TopNav from "./TopNav";
import AppRail from "./AppRail";
import { usePageHead } from "./PageHead";
import { useSidebarOpen } from "./SidebarOpenProvider";

const breadcrumbLinks = [
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
  breadcrumbLinks.forEach((o) => {
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

  return (
    <>
      <AppRail />
      <TopNav
        pageTitle={pageTitle}
        showNotices={true}
        toggleLeftMenu={() => setOpen(!open)}
      />
    </>
  );
};

export default Layout;
