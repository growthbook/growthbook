import { ReactNode, RefObject, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { PiMagnifyingGlassBold } from "react-icons/pi";
import { isDemoDatasourceProject } from "shared/demo-datasource";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useAuth } from "@/services/auth";
import { useSearch } from "@/services/search";
import usePermissions from "@/hooks/usePermissions";
import Badge from "@/ui/Badge";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import Text from "@/ui/Text";
import { TextField } from "@/ui/TextField";
import Tooltip from "@/ui/Tooltip";
import LetterAvatar from "./LetterAvatar";
import { InPlaceMenu, RailMenuEntry, RailMenuInPlace } from "./railMenu";
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
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const isTruncated = () => {
    const el = ref.current;
    return !!el && el.scrollWidth > el.clientWidth;
  };
  return (
    <Tooltip
      content={name}
      side="right"
      delayDuration={NAME_TOOLTIP_DELAY_MS}
      open={open}
      onOpenChange={(next) => setOpen(next && isTruncated())}
    >
      <span
        className={styles.projectOptionName}
        // Opened on entering, not by the tooltip's own pointer handling: while
        // the search field keeps focus, the menu cancels pointer moves
        // (keepSearchFocus), which the tooltip's trigger then ignores.
        onPointerEnter={(e) => {
          if (e.pointerType === "touch") return;
          window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => {
            if (isTruncated()) setOpen(true);
          }, NAME_TOOLTIP_DELAY_MS);
        }}
        onPointerLeave={() => {
          window.clearTimeout(timer.current);
          setOpen(false);
        }}
      >
        <Text ref={ref} weight={current ? "semibold" : "regular"} truncate>
          {name}
        </Text>
      </span>
    </Tooltip>
  );
}

// The menu's projects, sorted by name and filtered by its search, which shows
// past 15 projects.
function useProjectMenuItems() {
  const { projects } = useDefinitions();
  const { items, searchInputProps } = useSearch({
    items: projects.slice().sort((a, b) => (a.name > b.name ? 1 : -1)),
    defaultSortField: "name",
    localStorageKey: "project-selector",
    searchFields: ["name^3", "description"],
  });
  return {
    items,
    searchInputProps,
    showSearch: projects.length > PROJECT_SEARCH_THRESHOLD,
  };
}

// One project in the menu: main's avatar ("ALL" for All Projects), its name
// and, for the demo project, its badge.
function ProjectOptionContent({
  id,
  label,
  current,
  isDemo,
  optionRef,
}: {
  id: string;
  label: string;
  current: boolean;
  isDemo: boolean;
  // The selected project's, to scroll it into view as the menu opens.
  optionRef?: RefObject<HTMLSpanElement>;
}) {
  return (
    <span ref={optionRef} className={styles.projectOption}>
      <span className={styles.projectOptionAvatar} aria-hidden="true">
        <LetterAvatar
          name={id ? label : ""}
          defaultInitials="ALL"
          size="small"
        />
      </span>
      <TruncatedName name={label} current={current} />
      {isDemo ? <DemoBadge /> : null}
    </span>
  );
}

// The project menu: All Projects and each project, each with its avatar,
// under a search field once there are more than 15.
export function ProjectMenu({
  open,
  onOpenChange,
  trigger,
  menuSide,
  menuSideOffset,
  alignFirstRow = false,
  anchorRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: ReactNode;
  menuSide?: "bottom" | "right";
  menuSideOffset?: number;
  // Opening to the trigger's side: raised so its first row (the search
  // field, or All Projects) lines up with the trigger.
  alignFirstRow?: boolean;
  // With alignFirstRow, the trigger: the menu is capped to the space below
  // it, so a long list scrolls inside the menu rather than pushing it up.
  anchorRef?: RefObject<HTMLElement>;
}) {
  const { project, setProject } = useDefinitions();
  const { isDemo } = useProjectSelector();
  const searchRef = useRef<HTMLInputElement>(null);
  const { items, searchInputProps, showSearch } = useProjectMenuItems();

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
      <ProjectOptionContent
        id={id}
        label={label}
        current={id === project}
        isDemo={!!id && isDemo(id)}
        optionRef={id === project ? currentRef : undefined}
      />
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
      // As the profile menu's.
      menuWidth={280}
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

// Below 1180px, the drawer's project menu, drawn in its place as the
// profile and Help menus are there (railMenu.tsx): Back and the search
// field past 15 projects (both pinned while the list scrolls), then the
// projects.
// Choosing one closes the drawer.
export function ProjectMenuInPlace({ inPlace }: { inPlace: RailMenuInPlace }) {
  const { project, setProject } = useDefinitions();
  const { isDemo } = useProjectSelector();
  const { items, searchInputProps, showSearch } = useProjectMenuItems();
  const searchRef = useRef<HTMLInputElement>(null);

  // After InPlaceMenu's own focus on its first item: the search field
  // instead when it's there, and the selected project scrolled into view.
  useEffect(() => {
    const t = window.setTimeout(() => {
      if (showSearch) {
        searchRef.current?.focus({
          preventScroll: true,
          focusVisible: inPlace.fromKeyboard,
        } as FocusOptions);
      }
      inPlace.host
        ?.querySelector(`[data-menu-entry="${project || "all"}"]`)
        ?.scrollIntoView({ block: "nearest" });
    }, 0);
    return () => window.clearTimeout(t);
    // None of these change while it's open (choosing a project closes it).
  }, [showSearch, project, inPlace.host, inPlace.fromKeyboard]);

  const entries: RailMenuEntry[] = [
    ...(showSearch
      ? [
          {
            type: "node" as const,
            key: "search",
            node: (
              <div className={styles.projectSearchInPlace}>
                <TextField
                  ref={searchRef}
                  placeholder="Search"
                  type="search"
                  aria-label="Search projects"
                  prepend={<PiMagnifyingGlassBold size={14} />}
                  // Down moves into the projects; Esc goes back (InPlaceMenu).
                  onKeyDown={(e) => {
                    if (e.key !== "ArrowDown") return;
                    e.preventDefault();
                    inPlace.host
                      ?.querySelector<HTMLElement>(
                        "[data-menu-entry]:not([data-menu-entry=search])",
                      )
                      ?.focus();
                  }}
                  {...searchInputProps}
                />
              </div>
            ),
          },
        ]
      : []),
    ...[{ id: "", name: "All Projects" }, ...items].map(
      (p): RailMenuEntry => ({
        type: "item",
        key: p.id || "all",
        className: styles.projectInPlaceItem,
        content: (
          <ProjectOptionContent
            id={p.id}
            label={p.name}
            current={p.id === project}
            isDemo={!!p.id && isDemo(p.id)}
          />
        ),
        onSelect: () => setProject(p.id),
      }),
    ),
  ];

  return inPlace.host
    ? createPortal(
        <InPlaceMenu
          label="Project"
          entries={entries}
          inPlace={inPlace}
          pinBack
        />,
        inPlace.host,
      )
    : null;
}
