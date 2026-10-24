import { useEffect, useRef, useState } from "react";
import { PiFolder, PiMagnifyingGlassBold } from "react-icons/pi";
import { isDemoDatasourceProject } from "shared/demo-datasource";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useAuth } from "@/services/auth";
import { useSearch } from "@/services/search";
import usePermissions from "@/hooks/usePermissions";
import Button from "@/ui/Button";
import Badge from "@/ui/Badge";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import Text from "@/ui/Text";
import { TextField } from "@/ui/TextField";
import styles from "./HeaderBreadcrumb.module.scss";

const DEMO_BADGE_TITLE = "This is a demo project with sample data";
// main's Demo badge colour.
const DEMO_BADGE_COLOR = "#EB8045";

function DemoBadge() {
  return (
    <Badge
      label="Demo"
      title={DEMO_BADGE_TITLE}
      variant="solid"
      radius="full"
      size="xs"
      style={{ backgroundColor: DEMO_BADGE_COLOR, flexShrink: 0 }}
    />
  );
}

export default function ProjectSelector() {
  const { projects, project, getProjectById, setProject } = useDefinitions();
  const { orgId } = useAuth();
  const permissions = usePermissions();
  const current = getProjectById(project);
  const [open, setOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const { items, searchInputProps } = useSearch({
    items: projects.slice().sort((a, b) => (a.name > b.name ? 1 : -1)),
    defaultSortField: "name",
    localStorageKey: "project-selector",
    searchFields: ["name^3", "description"],
  });

  const heldToOneProject =
    projects.length === 1 && !permissions.check("readData", "");
  useEffect(() => {
    if (heldToOneProject) setProject(projects[0].id);
  }, [heldToOneProject, projects, setProject]);

  // Typing goes straight to the search field as the menu opens.
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => searchRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [open]);

  // No projects to pick from: the button's label alone, as plain text.
  if (!projects.length) {
    return (
      <span className={styles.projectPlain}>
        <PiFolder size={14} aria-hidden="true" />
        <span className={styles.projectName}>All Projects</span>
      </span>
    );
  }

  const isDemo = (id: string) =>
    isDemoDatasourceProject({ projectId: id, organizationId: orgId || "" });

  if (heldToOneProject) {
    return (
      <span className={styles.projectStatic}>
        <PiFolder size={14} className={styles.projectIcon} />
        <span className={styles.projectName}>{projects[0].name}</span>
        {isDemo(projects[0].id) ? <DemoBadge /> : null}
      </span>
    );
  }

  const name = current?.name || "All Projects";
  // Keeps focus in the search field: the menu would move it to the item
  // under the pointer unless pointermove's default is prevented.
  const keepSearchFocus = (e: React.PointerEvent) => {
    if (document.activeElement === searchRef.current) e.preventDefault();
  };
  const option = (id: string, label: string) => (
    <DropdownMenuItem
      key={id || "all"}
      className={styles.projectItem}
      onClick={() => setProject(id)}
    >
      <span className={styles.projectOption}>
        <Text weight={id === project ? "semibold" : "regular"} truncate>
          {label}
        </Text>
        {id && isDemo(id) ? <DemoBadge /> : null}
      </span>
    </DropdownMenuItem>
  );

  return (
    <DropdownMenu
      open={open}
      onOpenChange={setOpen}
      menuPlacement="start"
      menuWidth={220}
      variant="soft"
      trigger={
        <Button
          variant="ghost"
          color="gray"
          size="sm"
          // So the click reaches the menu's trigger.
          preventDefault={false}
          className={styles.headerButton}
          icon={<PiFolder size={14} />}
          aria-label={`Project: ${name}`}
        >
          <span className={styles.projectName}>{name}</span>
          {current && isDemo(current.id) ? (
            <span className={styles.demoBadgeSelected}>
              <DemoBadge />
            </span>
          ) : null}
        </Button>
      }
    >
      <div className={styles.projectSearch}>
        <TextField
          ref={searchRef}
          placeholder="Search"
          type="search"
          aria-label="Search projects"
          prepend={<PiMagnifyingGlassBold size={14} />}
          // Keys the menu would take for its own navigation stay with the
          // field (typing, Space, Home and End); Down moves into the
          // projects, and Esc still closes the menu.
          onKeyDown={(e) => {
            if (e.key.length === 1 || e.key === "Home" || e.key === "End") {
              e.stopPropagation();
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              e.currentTarget
                .closest("[role=menu]")
                ?.querySelector<HTMLElement>("[role=menuitem]")
                ?.focus();
            }
          }}
          {...searchInputProps}
        />
      </div>
      <div
        className={styles.projectList}
        onPointerMoveCapture={keepSearchFocus}
        onPointerOutCapture={keepSearchFocus}
      >
        {option("", "All Projects")}
        {items.map((p) => option(p.id, p.name))}
      </div>
    </DropdownMenu>
  );
}
