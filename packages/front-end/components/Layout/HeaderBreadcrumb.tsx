import { Fragment, ReactNode } from "react";
import clsx from "clsx";
import { PiCaretRightBold } from "react-icons/pi";
import LinkButton from "@/ui/LinkButton";
import ProjectSelector from "./ProjectSelector";
import { usePageHead } from "./PageHead";
import styles from "./HeaderBreadcrumb.module.scss";

// From <PageHead breadcrumb>: the first crumb is the section, the last the
// object.

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
  if (section) {
    if (section.href) buttonParts.add(parts.length);
    parts.push(
      section.href ? (
        <LinkButton key="section" href={section.href} {...crumbButtonProps}>
          <span className={styles.projectName}>{section.display}</span>
        </LinkButton>
      ) : (
        <span key="section" className={styles.sectionText}>
          {section.display}
        </span>
      ),
    );
  }
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
