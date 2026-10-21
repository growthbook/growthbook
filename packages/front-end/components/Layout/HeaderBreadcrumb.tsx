import { Fragment, ReactNode } from "react";
import clsx from "clsx";
import { PiCaretRightBold } from "react-icons/pi";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useAuth } from "@/services/auth";
import Button from "@/ui/Button";
import LinkButton from "@/ui/LinkButton";
import modalStandardStyles from "@/ui/Modal/Patterns/ModalStandard.module.scss";
import { HeaderProjectSelector } from "./ProjectSelector";
import { usePageHead } from "./PageHead";
import { useUserOrganizations } from "./ProfileMenu";
import { usePrototypeExistingPageColors } from "./PrototypeControls";
import styles from "./HeaderBreadcrumb.module.scss";

// The header's breadcrumb (app header redesign), up to 3 levels:
//   list / section page: [Project ▾]
//   detail page:         [Project ▾] / Section / Object name
// with "Org name /" first for users in more than one org. Built from what
// pages already pass to <PageHead breadcrumb> (the first crumb is the
// section, the last the object), so no page changes.

// A chevron between crumbs, as the redesign's breadcrumb before the new
// header (set in review; the design has a "/"), Phosphor's bold caret (set
// in review; was regular).
// Beside a button crumb, it's pulled 4px towards it (.afterButton,
// .beforeButton), the button's own padding already spacing it.
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
  const { orgId } = useAuth();
  const { projects } = useDefinitions();
  const organizations = useUserOrganizations();
  // PROTOTYPE: with "Interim colors" on, the crumbs' look before the
  // redesign (set in review): Button's own ghost, without the 400 label,
  // the --slate-12 / --gray-9 text and the 6px corners.
  const interimColors = usePrototypeExistingPageColors();
  const crumbStyle = (color: string) =>
    interimColors ? undefined : { borderRadius: "var(--radius-3)", color };

  const orgName =
    organizations.length > 1
      ? (organizations.find((o) => o.id === orgId)?.name ?? null)
      : null;

  // Section: the first crumb, when it links somewhere or there's an object
  // after it. Object: the last crumb, on detail pages (2+ crumbs).
  const section =
    breadcrumb.length >= 2 || breadcrumb[0]?.href ? breadcrumb[0] : null;
  const object =
    breadcrumb.length >= 2 ? breadcrumb[breadcrumb.length - 1] : null;

  const parts: ReactNode[] = [];
  // Which parts are buttons, for the chevrons' spacing.
  const buttonParts = new Set<number>();
  if (orgName) {
    parts.push(
      <span key="org" className={styles.org} title={orgName}>
        {orgName}
      </span>,
    );
  }
  // No projects in the org: no selector (as the sidebar's).
  if (projects.length) {
    buttonParts.add(parts.length);
    parts.push(<HeaderProjectSelector key="project" />);
  }
  // The section and the current page as the project selector's button
  // (set in review; were a link and plain text): @/ui/Button, ghost and
  // grey, small, the label at 400 (.ghostButton) in --slate-12, 6px
  // corners, the label truncating past 280px. The section links to its
  // page (@/ui/LinkButton); the current page is the same button, disabled,
  // in --gray-9.
  const crumbButtonProps = {
    variant: "ghost",
    color: "gray",
    size: "sm",
    className: clsx(
      styles.headerButton,
      !interimColors && modalStandardStyles.ghostButton,
    ),
  } as const;
  if (section) {
    if (section.href) buttonParts.add(parts.length);
    parts.push(
      section.href ? (
        <LinkButton
          key="section"
          href={section.href}
          {...crumbButtonProps}
          style={crumbStyle("var(--slate-12)")}
        >
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
    buttonParts.add(parts.length);
    parts.push(
      // The current page (the experiment page's switcher, from the design,
      // was removed in review). The wrapper names it the current page, as
      // a disabled button can't.
      <span
        key="object"
        className={styles.currentCrumb}
        aria-current="page"
        title={object.display}
      >
        {/* Disabled, its label in --gray-9, as the app's disabled tabs
          (global-radix-overrides.scss; set in review; tried --slate-11, and
          Radix's fainter disabled grey), and the plain arrow cursor. */}
        <Button
          {...crumbButtonProps}
          className={clsx(crumbButtonProps.className, styles.currentButton)}
          disabled
          style={crumbStyle("var(--gray-9)")}
        >
          <span className={styles.projectName}>{object.display}</span>
        </Button>
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
