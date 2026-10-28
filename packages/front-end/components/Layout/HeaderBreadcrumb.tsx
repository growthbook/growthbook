import { Fragment, ReactNode } from "react";
import clsx from "clsx";
import { PiCaretRightBold } from "react-icons/pi";
import type { BreadcrumbItem } from "@/ui/Breadcrumbs";
import LinkButton from "@/ui/LinkButton";
import ProjectSelector from "./ProjectSelector";
import { usePageHead } from "./PageHead";
import styles from "./HeaderBreadcrumb.module.scss";

// From <PageHead breadcrumb>: the first crumb is the section, the last the
// object; any between them, such as a report's experiment, sit in between.

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

  const section =
    breadcrumb.length >= 2 || breadcrumb[0]?.href ? breadcrumb[0] : null;
  const middle = breadcrumb.slice(1, -1);
  const object =
    breadcrumb.length >= 2 ? breadcrumb[breadcrumb.length - 1] : null;

  const parts: ReactNode[] = [];
  const buttonParts = new Set<number>();
  // With no projects, plain text in the button's box, spaced as one.
  buttonParts.add(parts.length);
  parts.push(<ProjectSelector key="project" />);
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
    <nav aria-label="Breadcrumb" className={styles.breadcrumb}>
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
