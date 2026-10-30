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
import {
  InPlaceMenu,
  SidebarMenuEntry,
  SidebarMenuInPlace,
} from "./SidebarMenu";
import { BOTTOM_TOOLTIP_DELAY_MS } from "./SidebarTooltip";
import styles from "./ProjectMenu.module.scss";

/** Above this many projects, the menu gets a search field. */
const PROJECT_SEARCH_THRESHOLD = 15;
/** Radix Themes' collision padding. */
const MENU_EDGE_MARGIN = 10;
/** The menu's top padding. */
const MENU_FIRST_ROW_OFFSET = 8;
/** The menu's top padding plus the search row's 4px above the field. */
const MENU_SEARCH_ROW_OFFSET = 12;

const DEMO_BADGE_TITLE = "This is a demo project with sample data";
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
    current,
    heldToOneProject,
    isDemo,
    name: current?.name || "All Projects",
  };
}

/** Shows the full name in a tooltip once it's cut off. */
function TruncatedName({ name, current }: { name: string; current: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const isTruncated = () => {
    const el = ref.current;
    return !!el && el.scrollWidth > el.clientWidth;
  };
  // Reached from the keyboard, a cut-off name shows in full too: on its
  // row's focus, in the dropdown and in the drawer alike.
  useEffect(() => {
    const row = ref.current?.closest<HTMLElement>(
      "[role=menuitem], [data-menu-entry]",
    );
    if (!row) return;
    const onFocus = () => {
      if (row.matches(":focus-visible") && isTruncated()) setOpen(true);
    };
    const onBlur = () => setOpen(false);
    row.addEventListener("focus", onFocus);
    row.addEventListener("blur", onBlur);
    return () => {
      row.removeEventListener("focus", onFocus);
      row.removeEventListener("blur", onBlur);
    };
  }, []);
  return (
    <Tooltip
      content={name}
      side="right"
      delayDuration={BOTTOM_TOOLTIP_DELAY_MS}
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
          }, BOTTOM_TOOLTIP_DELAY_MS);
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

function useProjectMenuItems() {
  const { projects } = useDefinitions();
  const showSearch = projects.length > PROJECT_SEARCH_THRESHOLD;
  const { items, searchInputProps, clear } = useSearch({
    items: projects.slice().sort((a, b) => (a.name > b.name ? 1 : -1)),
    defaultSortField: "name",
    localStorageKey: "project-selector",
    searchFields: ["name^3", "description"],
    // Without a search field, the page's ?q= would filter the menu unseen.
    disableUrlSearchTerm: !showSearch,
  });
  // Nor a term typed before the field went away (a deleted project took the
  // count under the threshold): the sidebar's menu stays mounted, term and all.
  useEffect(() => {
    if (!showSearch) clear();
  }, [showSearch, clear]);
  return { items, searchInputProps, showSearch };
}

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
  /** Set on the selected project, to scroll it into view as the menu opens. */
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

/** Opens to the right, its first row level with the trigger. */
export function ProjectMenu({
  open,
  onOpenChange,
  trigger,
  anchorRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: ReactNode;
  /**
   * The menu is capped to the space below this, so a long list scrolls instead
   * of pushing the menu up.
   */
  anchorRef: RefObject<HTMLElement>;
}) {
  const { project, setProject } = useDefinitions();
  const { isDemo } = useProjectSelector();
  const searchRef = useRef<HTMLInputElement>(null);
  const { items, searchInputProps, showSearch } = useProjectMenuItems();

  const alignOffset = -(showSearch
    ? MENU_SEARCH_ROW_OFFSET
    : MENU_FIRST_ROW_OFFSET);
  const [maxHeight, setMaxHeight] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (!open || !anchorRef.current) return;
    const anchor = anchorRef.current;
    const update = () => {
      const menuTop = anchor.getBoundingClientRect().top + alignOffset;
      setMaxHeight(
        Math.max(0, window.innerHeight - MENU_EDGE_MARGIN - menuTop),
      );
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [open, anchorRef, alignOffset]);

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

  // The menu moves focus to the item under the pointer unless pointermove's
  // default is prevented.
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
      menuSide="right"
      // 8px past the sidebar's edge: the item sits 8px inside it.
      menuSideOffset={16}
      menuAlignOffset={alignOffset}
      menuMaxHeight={maxHeight}
      menuClassName={showSearch ? styles.projectMenuWithSearch : undefined}
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
            aria-label="Search Projects"
            prepend={<PiMagnifyingGlassBold size={14} />}
            // Typing, Space, Home and End stay with the field; Down moves
            // into the projects, and Esc still closes the menu.
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

/**
 * The drawer's project menu, drawn in place like its profile and Help menus
 * (SidebarMenu.tsx).
 */
export function ProjectMenuInPlace({
  inPlace,
}: {
  inPlace: SidebarMenuInPlace;
}) {
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

  const entries: SidebarMenuEntry[] = [
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
                  aria-label="Search Projects"
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
      (p): SidebarMenuEntry => ({
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
