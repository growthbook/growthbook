import { Fragment, ReactNode } from "react";
import Link from "next/link";
import clsx from "clsx";
import { useRouter } from "next/router";
import { PiCaretRight } from "react-icons/pi";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useAuth } from "@/services/auth";
import { HeaderProjectSelector } from "./ProjectSelector";
import { usePageHead } from "./PageHead";
import { useUserOrganizations } from "./ProfileMenu";
import styles from "./HeaderBreadcrumb.module.scss";

// The header's breadcrumb (app header redesign), up to 3 levels:
//   list / section page: [Project ▾]
//   detail page:         [Project ▾] / Section / Object name
// with "Org name /" first for users in more than one org. Built from what
// pages already pass to <PageHead breadcrumb> (the first crumb is the
// section, the last the object), so no page changes.

// Pages that aren't project-scoped: the project selector shows, disabled.
const NON_PROJECT_ROUTES =
  /^(settings|account|admin|integrations|events|importing|projects|project\/)/;

// A chevron between crumbs, as the redesign's breadcrumb before the new
// header (set in review; the design has a "/").
function Separator({ afterProject }: { afterProject: boolean }) {
  return (
    <span
      className={clsx(styles.separator, afterProject && styles.afterProject)}
      aria-hidden="true"
    >
      <PiCaretRight size={12} />
    </span>
  );
}

export default function HeaderBreadcrumb() {
  const router = useRouter();
  const route = router.route.substring(1);
  const { breadcrumb } = usePageHead();
  const { orgId } = useAuth();
  const { projects } = useDefinitions();
  const organizations = useUserOrganizations();

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
  let projectIndex = -1;
  if (orgName) {
    parts.push(
      <span key="org" className={styles.org} title={orgName}>
        {orgName}
      </span>,
    );
  }
  // No projects in the org: no selector (as the sidebar's).
  if (projects.length) {
    projectIndex = parts.length;
    parts.push(
      <HeaderProjectSelector
        key="project"
        disabled={NON_PROJECT_ROUTES.test(route)}
      />,
    );
  }
  if (section) {
    parts.push(
      section.href ? (
        <Link key="section" href={section.href} className={styles.section}>
          {section.display}
        </Link>
      ) : (
        <span key="section" className={styles.sectionText}>
          {section.display}
        </span>
      ),
    );
  }
  if (object) {
    parts.push(
      // Plain text on every detail page (set in review; the experiment
      // page's switcher, from the design, was removed).
      <span
        key="object"
        className={styles.objectText}
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
          {i > 0 ? <Separator afterProject={i - 1 === projectIndex} /> : null}
          {part}
        </Fragment>
      ))}
    </nav>
  );
}
