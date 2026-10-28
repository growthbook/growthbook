import { ReactNode, RefObject, useEffect, useRef, useState } from "react";
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
import Tooltip from "@/ui/Tooltip";
import LetterAvatar from "./LetterAvatar";
import styles from "./HeaderBreadcrumb.module.scss";

// Up to this many projects fit the menu at a glance, without a search field.
const PROJECT_SEARCH_THRESHOLD = 15;
// The menu's distance from the window's edge (Radix Themes' collision
// padding).
const MENU_EDGE_MARGIN = 10;
// The menu's 8px padding, and the search row's 4px above the field.
const MENU_FIRST_ROW_OFFSET = 8;
const MENU_SEARCH_ROW_OFFSET = 12;
// Truncated names' tooltips show after a brief pause, as the side nav's.
const NAME_TOOLTIP_DELAY_MS = 300;

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

// A project's name in the menu, its full name in a tooltip once it's cut off.
function TruncatedName({ name, current }: { name: string; current: boolean }) {
  // The text itself truncates; the span around it is the tooltip's trigger.
  const ref = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <Tooltip
      content={name}
      side="right"
      delayDuration={NAME_TOOLTIP_DELAY_MS}
      open={open}
      onOpenChange={(next) => {
        const el = ref.current;
        setOpen(next && !!el && el.scrollWidth > el.clientWidth);
      }}
    >
      <span className={styles.projectOptionName}>
        <Text ref={ref} weight={current ? "semibold" : "regular"} truncate>
          {name}
        </Text>
      </span>
    </Tooltip>
  );
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
  alignFirstRow = false,
  anchorRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: ReactNode;
  avatars?: boolean;
  menuSide?: "bottom" | "right";
  menuSideOffset?: number;
  // Opening to the trigger's side: raised so its first row (the search
  // field, or All Projects) lines up with the trigger.
  alignFirstRow?: boolean;
  // With alignFirstRow, the trigger: the menu is capped to the space below
  // it, so a long list scrolls inside the menu rather than pushing it up.
  anchorRef?: RefObject<HTMLElement>;
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

  const alignOffset = alignFirstRow
    ? -(showSearch ? MENU_SEARCH_ROW_OFFSET : MENU_FIRST_ROW_OFFSET)
    : undefined;
  const [maxHeight, setMaxHeight] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (!open || !alignFirstRow || !anchorRef?.current) return;
    const anchor = anchorRef.current;
    const update = () => {
      const menuTop = anchor.getBoundingClientRect().top + (alignOffset ?? 0);
      setMaxHeight(
        Math.max(0, window.innerHeight - MENU_EDGE_MARGIN - menuTop),
      );
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [open, alignFirstRow, anchorRef, alignOffset]);

  // As the menu opens, typing goes straight to the search field, and the
  // selected project scrolls into view.
  const currentRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => {
      if (showSearch) searchRef.current?.focus({ preventScroll: true });
      currentRef.current
        ?.closest("[role=menuitem]")
        ?.scrollIntoView({ block: "nearest" });
    }, 0);
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
      // Typing jumps by the name, not the avatar's initials before it.
      textValue={label}
    >
      <span
        className={styles.projectOption}
        ref={id === project ? currentRef : undefined}
      >
        {avatars ? (
          <span className={styles.projectOptionAvatar} aria-hidden="true">
            <LetterAvatar
              name={id ? label : ""}
              defaultInitials="ALL"
              size="small"
            />
          </span>
        ) : null}
        <TruncatedName name={label} current={id === project} />
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
      menuAlignOffset={alignOffset}
      menuMaxHeight={alignFirstRow ? maxHeight : undefined}
      menuClassName={showSearch ? styles.projectMenuWithSearch : undefined}
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

// The project's avatar in the header (main's small 26px one, shown at 20px
// to fit the 24px button), "ALL" for All Projects.
function HeaderProjectAvatar({ name }: { name: string }) {
  return (
    <span className={styles.headerProjectAvatar} aria-hidden="true">
      <LetterAvatar name={name} defaultInitials="ALL" size="small" />
    </span>
  );
}

// The header breadcrumb's selector, below 1180px (the side nav has its own
// above it, RailProjectSelector.tsx). Its avatars and menu are the side
// nav's, so the menu looks the same at every width.
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
        <HeaderProjectAvatar name={projects[0].name} />
        <span className={styles.projectName}>{projects[0].name}</span>
        {isDemo(projects[0].id) ? <DemoBadge /> : null}
      </span>
    );
  }

  return (
    <ProjectMenu
      open={open}
      onOpenChange={setOpen}
      avatars
      trigger={
        <Button
          variant="ghost"
          color="gray"
          size="sm"
          // So the click reaches the menu's trigger.
          preventDefault={false}
          className={`${styles.headerButton} ${styles.projectButton}`}
          icon={<HeaderProjectAvatar name={current?.name ?? ""} />}
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
