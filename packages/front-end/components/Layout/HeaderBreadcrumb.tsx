import { Fragment, ReactNode } from "react";
import clsx from "clsx";
import { useRouter } from "next/router";
import { PiCaretRightBold } from "react-icons/pi";
import type { BreadcrumbItem } from "@/ui/Breadcrumbs";
import LinkButton from "@/ui/LinkButton";
import { usePageHead } from "./PageHead";
import { navlinks } from "./sidebarNav";
import styles from "./HeaderBreadcrumb.module.scss";

function sideNavPageName(route: string): string | null {
  for (const link of navlinks) {
    // The sidebar shows Settings as one item, so use that name, not its
    // first page's ("General").
    if (link.name === "Settings" && route === link.href.substring(1)) {
      return link.name;
    }
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

/**
 * Renders <PageHead breadcrumb>: the section first, the object last. A list
 * page shows only its own name.
 */
export default function HeaderBreadcrumb({
  pageTitle,
}: {
  /** Fallback when the page sets no breadcrumb, e.g. Home (Layout.tsx). */
  pageTitle?: string;
}) {
  const { breadcrumb } = usePageHead();
  const router = useRouter();

  const isDetail = breadcrumb.length >= 2;
  const listPageName = isDetail
    ? null
    : (breadcrumb[0]?.display ??
      sideNavPageName(router.route.substring(1)) ??
      (pageTitle || null));
  const section = isDetail ? breadcrumb[0] : null;
  const middle = breadcrumb.slice(1, -1);
  const object = isDetail
    ? breadcrumb[breadcrumb.length - 1]
    : listPageName
      ? { display: listPageName }
      : null;

  const parts: ReactNode[] = [];
  const buttonParts = new Set<number>();
  const crumbButtonProps = {
    variant: "ghost",
    color: "gray",
    size: "sm",
    className: styles.headerButton,
  } as const;
  const pushCrumb = (crumb: BreadcrumbItem, key: string) => {
    // Plain-text crumbs are padded like the buttons (HeaderBreadcrumb.module
    // .scss), so they're spaced the same.
    buttonParts.add(parts.length);
    parts.push(
      crumb.href ? (
        <LinkButton key={key} href={crumb.href} {...crumbButtonProps}>
          <span className={styles.crumbLinkText}>{crumb.display}</span>
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
    // Spaced like a button, but plain text: it isn't an action.
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
        buttonParts.has(0) && styles.leadingButton,
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
