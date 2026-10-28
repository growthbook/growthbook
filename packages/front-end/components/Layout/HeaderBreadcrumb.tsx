import { Fragment, ReactNode } from "react";
import clsx from "clsx";
import { useRouter } from "next/router";
import { PiCaretRightBold } from "react-icons/pi";
import type { BreadcrumbItem } from "@/ui/Breadcrumbs";
import LinkButton from "@/ui/LinkButton";
import ProjectSelector from "./ProjectSelector";
import { usePageHead } from "./PageHead";
import { useNarrowLayout } from "./narrowLayout";
import { navlinks } from "./sidebarNav";
import styles from "./HeaderBreadcrumb.module.scss";

// From <PageHead breadcrumb>: the first crumb is the section, the last the
// object; any between them, such as a report's experiment, sit in between.
// From 1180px up the project selector is in the side nav, so a list page
// shows its own name as the one, current crumb, and a detail page starts at
// its section (a link). Below 1180px the selector comes first.

// The side nav's name for the page at this route (e.g. Experiments); null for
// a page that isn't in it.
function sideNavPageName(route: string): string | null {
  for (const link of navlinks) {
    const page = (link.subLinks || []).find((l) => l.path.test(route));
    if (page) return page.name;
  }
  return null;
}

function Separator({
  afterButton,
  beforeButton,
}: {
  afterButton: boolean;
  beforeButton: boolean;
}) {
  return (
    <span
      className={clsx(
        styles.separator,
        afterButton && styles.afterButton,
        beforeButton && styles.beforeButton,
      )}
      aria-hidden="true"
    >
      <PiCaretRightBold size={12} />
    </span>
  );
}

export default function HeaderBreadcrumb() {
  const { breadcrumb } = usePageHead();
  const router = useRouter();
  const projectInHeader = useNarrowLayout();

  const isDetail = breadcrumb.length >= 2;
  const listPageName = isDetail
    ? null
    : (breadcrumb[0]?.display ??
      sideNavPageName(router.route.substring(1)) ??
      null);
  const section =
    isDetail || (projectInHeader && breadcrumb[0]?.href) ? breadcrumb[0] : null;
  const middle = breadcrumb.slice(1, -1);
  const object = isDetail
    ? breadcrumb[breadcrumb.length - 1]
    : projectInHeader || !listPageName
      ? null
      : { display: listPageName };

  const parts: ReactNode[] = [];
  const buttonParts = new Set<number>();
  if (projectInHeader) {
    // With no projects, plain text in the button's box, spaced as one.
    buttonParts.add(parts.length);
    parts.push(<ProjectSelector key="project" />);
  }
  const crumbButtonProps = {
    variant: "ghost",
    color: "gray",
    size: "sm",
    className: styles.headerButton,
  } as const;
  const pushCrumb = (crumb: BreadcrumbItem, key: string) => {
    if (crumb.href) buttonParts.add(parts.length);
    parts.push(
      crumb.href ? (
        <LinkButton key={key} href={crumb.href} {...crumbButtonProps}>
          <span className={styles.projectName}>{crumb.display}</span>
        </LinkButton>
      ) : (
        <span key={key} className={styles.sectionText}>
          {crumb.display}
        </span>
      ),
    );
  };
  if (section) pushCrumb(section, "section");
  middle.forEach((crumb, i) => pushCrumb(crumb, `middle-${i}`));
  if (object) {
    // Not a button: it isn't an action.
    buttonParts.add(parts.length);
    parts.push(
      <span
        key="object"
        className={styles.currentCrumb}
        aria-current="page"
        title={object.display}
      >
        {object.display}
      </span>,
    );
  }

  return (
    <nav
      aria-label="Breadcrumb"
      className={clsx(
        styles.breadcrumb,
        !projectInHeader && buttonParts.has(0) && styles.leadingButton,
      )}
    >
      {parts.map((part, i) => (
        <Fragment key={i}>
          {i > 0 ? (
            <Separator
              afterButton={buttonParts.has(i - 1)}
              beforeButton={buttonParts.has(i)}
            />
          ) : null}
          {part}
        </Fragment>
      ))}
    </nav>
  );
}
