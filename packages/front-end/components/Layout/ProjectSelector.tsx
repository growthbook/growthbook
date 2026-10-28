import { ReactNode, useEffect, useRef, useState } from "react";
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
import LetterAvatar from "./LetterAvatar";
import styles from "./HeaderBreadcrumb.module.scss";

// Up to this many projects fit the menu at a glance, without a search field.
const PROJECT_SEARCH_THRESHOLD = 15;

const DEMO_BADGE_TITLE = "This is a demo project with sample data";
// main's Demo badge color.
const DEMO_BADGE_COLOR = "#EB8045";

export function DemoBadge() {
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

// What the header's and the side nav's selectors share: the projects, the
// current one, and whether the user is held to one (no menu, then).
export function useProjectSelector() {
  const { projects, project, getProjectById, setProject } = useDefinitions();
  const { orgId } = useAuth();
  const permissions = usePermissions();
  const current = getProjectById(project);

  const heldToOneProject =
    projects.length === 1 && !permissions.check("readData", "");
  useEffect(() => {
    if (heldToOneProject) setProject(projects[0].id);
  }, [heldToOneProject, projects, setProject]);

  const isDemo = (id: string) =>
    isDemoDatasourceProject({ projectId: id, organizationId: orgId || "" });

  return {
    projects,
    project,
    current,
    heldToOneProject,
    isDemo,
    name: current?.name || "All Projects",
  };
}

// The project menu: All Projects and each project, under a search field once
// there are more than 15. With
// `avatars`, each has main's avatar beside its name ("ALL" for All Projects).
export function ProjectMenu({
  open,
  onOpenChange,
  trigger,
  avatars = false,
  menuSide,
  menuSideOffset,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: ReactNode;
  avatars?: boolean;
  menuSide?: "bottom" | "right";
  menuSideOffset?: number;
}) {
  const { projects, project, setProject } = useDefinitions();
  const { isDemo } = useProjectSelector();
  const searchRef = useRef<HTMLInputElement>(null);
  const showSearch = projects.length > PROJECT_SEARCH_THRESHOLD;

  const { items, searchInputProps } = useSearch({
    items: projects.slice().sort((a, b) => (a.name > b.name ? 1 : -1)),
    defaultSortField: "name",
    localStorageKey: "project-selector",
    searchFields: ["name^3", "description"],
  });

  // Typing goes straight to the search field as the menu opens.
  useEffect(() => {
    if (!open || !showSearch) return;
    const t = window.setTimeout(() => searchRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [open, showSearch]);

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
        {avatars ? (
          <span className={styles.projectOptionAvatar} aria-hidden="true">
            <LetterAvatar
              name={id ? label : ""}
              defaultInitials="ALL"
              size="small"
            />
          </span>
        ) : null}
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
      onOpenChange={onOpenChange}
      menuPlacement="start"
      menuSide={menuSide}
      menuSideOffset={menuSideOffset}
      menuWidth={avatars ? 240 : 220}
      variant="soft"
      trigger={trigger}
    >
      {showSearch ? (
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
      ) : null}
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

// The header breadcrumb's selector, below 1180px (the side nav has its own
// above it, RailProjectSelector.tsx).
export default function ProjectSelector() {
  const { projects, current, heldToOneProject, isDemo, name } =
    useProjectSelector();
  const [open, setOpen] = useState(false);

  // No projects to pick from: the button's label alone, as plain text.
  if (!projects.length) {
    return (
      <span className={styles.projectPlain}>
        <PiFolder size={14} aria-hidden="true" />
        <span className={styles.projectName}>All Projects</span>
      </span>
    );
  }

  if (heldToOneProject) {
    return (
      <span className={styles.projectStatic}>
        <PiFolder size={14} className={styles.projectIcon} />
        <span className={styles.projectName}>{projects[0].name}</span>
        {isDemo(projects[0].id) ? <DemoBadge /> : null}
      </span>
    );
  }

  return (
    <ProjectMenu
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button
          variant="ghost"
          color="gray"
          size="sm"
          // So the click reaches the menu's trigger.
          preventDefault={false}
          className={`${styles.headerButton} ${styles.projectButton}`}
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
    />
  );
}
