import {
  CSSProperties,
  Dispatch,
  ReactNode,
  SetStateAction,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import clsx from "clsx";
import { GenIcon, IconType } from "react-icons";
import {
  PiArrowCircleUp,
  PiCaretRightBold,
  PiChartLine,
  PiCode,
  PiDatabase,
  PiFlagPennant,
  PiFlask,
  PiGearSix,
  PiMagnifyingGlass,
  PiSidebarSimple,
} from "react-icons/pi";
import { useGrowthBook } from "@growthbook/growthbook-react";
import { AppFeatures } from "shared/types/app-features";
import { useUser } from "@/services/UserContext";
import { useDefinitions } from "@/services/DefinitionsContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import useOrgSettings from "@/hooks/useOrgSettings";
import UpgradeModal from "@/components/Settings/UpgradeModal";
import { Popover } from "@/ui/Popover";
import Tooltip from "@/ui/Tooltip";
import Badge from "@/ui/Badge";
import listTableStyles from "@/components/Experiment/ExperimentsListTable.module.scss";
import { useAgentPanel } from "@/components/Agent/AgentPanelContext";
import ProfileMenu from "./ProfileMenu";
import HelpMenu from "./HelpMenu";
import { BOTTOM_TOOLTIP_DELAY_MS } from "./railTooltips";
import {
  usePrototypeDockedGrowthBot,
  usePrototypeInterimSettings,
} from "./PrototypeControls";
import GrowthBookLogo from "./GrowthBookLogo";
import { OPTICAL_STROKE, withOpticalWeight } from "./opticalWeight";
import {
  buildSidebarLinkFilterProps,
  SidebarLinkFilterProps,
  SidebarLinkProps,
} from "./SidebarLink";
import { navlinks } from "./sidebarNav";
import { useSidebarOpen } from "./SidebarOpenProvider";
import styles from "./AppRail.module.scss";

// The app's side nav (the "rail"), as the app header + side nav redesign
// (app-header-rail-handoff.md). Two states, saved per user in this browser:
// collapsed (48px, icons only; sections open a popover of their pages) and
// expanded (240px, labels; sections are accordions). Toggled by the button at
// the bottom and the [ key. Below 1180px it's the off-canvas drawer, always
// expanded, opened from the header's menu button, as before.
//
// Sections and their pages come from sidebarNav.ts (unchanged, so permission
// and feature-flag filters, beta flags and the ⌘K palette stay in sync), less
// Home (the logo links home) and Settings: Settings is a single link (its
// pages are reached from the Settings page while Settings is redesigned as
// one page). SDK Configuration is a main section (set in review; its pages
// were reached from Settings too).

// Search's magnifying glass, thickened (opticalWeight.tsx; set in review).
const SearchIcon = withOpticalWeight(PiMagnifyingGlass);
// Settings' gear-six, the same (set in review).
const SettingsIcon = withOpticalWeight(PiGearSix);

// Phosphor's lightbulb (regular) without the curved highlight inside the
// bulb (set in review): its own path, less that last part. Thickened, as
// withOpticalWeight does.
const LightbulbNoHighlight: IconType = GenIcon({
  tag: "svg",
  attr: { viewBox: "0 0 256 256", fill: "currentColor" },
  child: [
    {
      tag: "path",
      attr: {
        stroke: "currentColor",
        strokeWidth: String(OPTICAL_STROKE),
        strokeLinejoin: "round",
        d: "M176,232a8,8,0,0,1-8,8H88a8,8,0,0,1,0-16h80A8,8,0,0,1,176,232Zm40-128a87.55,87.55,0,0,1-33.64,69.21A16.24,16.24,0,0,0,176,186v6a16,16,0,0,1-16,16H96a16,16,0,0,1-16-16v-6a16,16,0,0,0-6.23-12.66A87.59,87.59,0,0,1,40,104.49C39.74,56.83,78.26,17.14,125.88,16A88,88,0,0,1,216,104Zm-16,0a72,72,0,0,0-73.74-72c-39,.92-70.47,33.39-70.26,72.39a71.65,71.65,0,0,0,27.64,56.3A32,32,0,0,1,96,186v6h64v-6a32.15,32.15,0,0,1,12.47-25.35A71.65,71.65,0,0,0,200,104Z",
      },
      child: [],
    },
  ],
});

// Phosphor's regular weight, the closest to the design's ~1.7 stroke icons.
const SECTION_ICONS: Record<string, IconType> = {
  // flag-pennant and chart-line (set in review; were the flag and the bar
  // chart; tried toggle-left and flag-banner for Features).
  // Features, Experimentation and Product Analytics thickened, as the
  // lightbulb (set in review).
  Features: withOpticalWeight(PiFlagPennant),
  Experimentation: withOpticalWeight(PiFlask),
  "Product Analytics": withOpticalWeight(PiChartLine),
  "Metrics and Data": PiDatabase,
  Insights: LightbulbNoHighlight,
  // A main section below Insights (set in review; was in the Settings
  // menu), with its pages as today; the code icon, as today's sidebar's,
  // thickened as the others (set in review).
  "SDK Configuration": withOpticalWeight(PiCode),
};
const RAIL_SECTIONS = navlinks.filter((l) => !!SECTION_ICONS[l.name]);
const SETTINGS_LINK = navlinks.find((l) => l.name === "Settings");

const COLLAPSED_CLASS = "app-rail-collapsed";
// The rail's width transition (AppRail.module.scss's .rail).
const RAIL_WIDTH_TRANSITION_MS = 200;
// The rail's icons: 18px, in a 32px column, collapsed and expanded (set in
// review; were 20px in 40px squares and 36px rows; tried 16px and 20px).
const ICON_SIZE = 18;
// Hover opens a section's popover at once (set in review; was after
// 150ms). Leaving waits 150ms, so the pointer can cross the gap into it.
const HOVER_CLOSE_DELAY_MS = 150;
// From a section popover's top to its first page: 8px padding, the 28px
// header (8px + 14px + 6px) and the 1px gap (AppRail.module.scss).
const POPOVER_FIRST_ITEM_OFFSET_PX = 37;
// A section popover's bottom padding (12px).
const POPOVER_BOTTOM_PADDING_PX = 12;
// The collapsed items' tooltips, at once too (set in review; was 150ms).
const TOOLTIP_DELAY_MS = 0;
// The bottom items' wait briefly (railTooltips.ts).

// Runs before paint in the browser (so a saved collapsed rail never flashes
// open), and as a plain effect on the server.
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

const isMac = () =>
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(navigator.userAgent);

// The rail's collapsed state, per user, in localStorage. AppRail puts
// .app-rail-collapsed on <html> from it, which sets --app-rail-width
// (global.scss) for everything laid out beside the rail.
function useRailCollapsed(): [boolean, () => void] {
  const { userId } = useUser();
  const key = userId ? `gb-app-rail-collapsed:${userId}` : null;
  const [collapsed, setCollapsed] = useState(false);

  useIsomorphicLayoutEffect(() => {
    if (!key) return;
    let saved = false;
    try {
      saved = window.localStorage.getItem(key) === "true";
    } catch (e) {
      // Storage blocked: start expanded.
    }
    setCollapsed(saved);
  }, [key]);

  // (.app-rail-collapsed is set by AppRail, from this and the docked
  // GrowthBot rail's temporary collapse.)

  const toggle = () => {
    setCollapsed((c) => {
      const next = !c;
      try {
        if (key) window.localStorage.setItem(key, String(next));
      } catch (e) {
        // Storage blocked: the toggle still works for this page view.
      }
      return next;
    });
  };
  return [collapsed, toggle];
}

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) ||
    !!target.closest("[role='dialog'], [role='menu'], [role='listbox']")
  );
}

function Keycap({ children }: { children: ReactNode }) {
  return (
    <span className={styles.keycap} aria-hidden="true">
      {children}
    </span>
  );
}

type PageGroup = { name: string; pages: SidebarLinkProps[] };

type Section = {
  link: SidebarLinkProps;
  Icon: IconType;
  pages: SidebarLinkProps[];
  // Its pages in named groups, in columns side by side, a column holding
  // one group or more stacked (the interim Settings menu), in place of one
  // list under the section's name.
  columns?: PageGroup[][];
};

function permittedSections(filterProps: SidebarLinkFilterProps): Section[] {
  return RAIL_SECTIONS.flatMap((link) => {
    if (link.filter && !link.filter(filterProps)) return [];
    const pages = (link.subLinks || []).filter(
      (l) => !l.filter || l.filter(filterProps),
    );
    if (!pages.length) return [];
    return [{ link, Icon: SECTION_ICONS[link.name], pages }];
  });
}

// PROTOTYPE: the interim Settings menu (PrototypeControls.tsx's "Interim
// settings menu"; set in review). Until Settings is redesigned as its own
// page with its own navigation, Settings is a section like the others, its
// menu holding every page today's Settings has (the same permission and
// feature filters), in three columns, a group each: Organization,
// Integrations and Customization. A Settings page not listed here goes
// under Organization. (Set in review: tried two columns and three; then
// four, with SDK Configuration first, until it became a main section.)
const INTERIM_SETTINGS_GROUPS: { name: string; pages: string[] }[] = [
  {
    name: "Organization",
    pages: [
      "/settings",
      "/projects",
      "/settings/team",
      "/settings/usage",
      "/settings/billing",
      "/events",
      "/admin",
    ],
  },
  {
    name: "Customization",
    pages: [
      "/settings/tags",
      "/settings/customfields",
      "/settings/custom-markdown",
      "/settings/custom-hooks",
    ],
  },
  {
    name: "Integrations",
    pages: [
      "/settings/keys",
      "/settings/webhooks",
      "/integrations/slack",
      "/importing",
    ],
  },
];

function permittedPages(
  link: SidebarLinkProps | undefined,
  filterProps: SidebarLinkFilterProps,
): SidebarLinkProps[] {
  if (!link || (link.filter && !link.filter(filterProps))) return [];
  return (link.subLinks || []).filter(
    (l) => !l.filter || l.filter(filterProps),
  );
}

function interimSettingsSection(
  filterProps: SidebarLinkFilterProps,
): Section | null {
  if (!SETTINGS_LINK) return null;
  const settingsPages = permittedPages(SETTINGS_LINK, filterProps);
  const listed = new Set(INTERIM_SETTINGS_GROUPS.flatMap((g) => g.pages));
  const group = (index: number): PageGroup => {
    const { name, pages: hrefs } = INTERIM_SETTINGS_GROUPS[index];
    const pages = hrefs.flatMap((href) =>
      settingsPages.filter((p) => p.href === href),
    );
    // Organization also takes any page not sorted above.
    if (index === 0) {
      pages.push(...settingsPages.filter((p) => !listed.has(p.href)));
    }
    return { name, pages };
  };
  const organization = group(0);
  const customization = group(1);
  const integrations = group(2);
  // Most used on the left (set in review): Organization, Integrations, then
  // Customization. (SDK Configuration was the first column, until it moved
  // to a main section; set in review.)
  const columns = [[organization], [integrations], [customization]]
    .map((column) => column.filter((g) => g.pages.length))
    .filter((column) => column.length);
  if (!columns.length) return null;
  return {
    link: SETTINGS_LINK,
    Icon: SettingsIcon,
    // Organization's first, so a click on Settings still goes to General,
    // not SDK Connections (set in review).
    pages: [organization, integrations, customization].flatMap((g) => g.pages),
    columns,
  };
}

// Pages reached from another page in a menu, that a menu item should show
// as current too (set in review): the role pages, from Members' Roles tab.
// Kept here, not in sidebarNav.ts, so ⌘K search and the old sidebar are
// unchanged.
const CURRENT_PAGE_ALIASES: Record<string, RegExp> = {
  "/settings/team": /^settings\/role/,
};

function isCurrentPage(page: SidebarLinkProps, route: string): boolean {
  return (
    page.path.test(route) || !!CURRENT_PAGE_ALIASES[page.href]?.test(route)
  );
}

function PageBadge({ page }: { page: SidebarLinkProps }) {
  return page.beta ? (
    <Badge color="indigo" label="Beta" variant="soft" size="xs" ml="1" />
  ) : null;
}

// A collapsed section: its icon, opening a popover of its pages on hover
// (at once) or keyboard focus; a click goes to its first page (set in
// review). Enter, Space or → move focus into the list; Escape closes it.
//
// One section's popover at a time (fix, set in review: each section kept
// its own state, so moving between icons, or hovering one while another was
// pinned open by a click, showed several at once). The rail holds which
// one is open; opening one closes any other.
function CollapsedSection({
  section,
  active,
  route,
  openMenu,
  setOpenMenu,
  row = false,
  atBottom = false,
  tapOpens = false,
}: {
  section: Section;
  active: boolean;
  route: string;
  openMenu: string | null;
  setOpenMenu: Dispatch<SetStateAction<string | null>>;
  // The expanded rail's row (icon and name) as the trigger, in place of
  // the icon alone (the interim Settings menu, in either rail).
  row?: boolean;
  // In the rail's bottom group: the menu grows up from the item, its last
  // page level with it, so a long menu stays on screen.
  atBottom?: boolean;
  // On a touch screen, with no hover to show the menu: a tap opens it (and
  // a second closes it) instead of going to the first page.
  tapOpens?: boolean;
}) {
  const router = useRouter();
  const name = section.link.name;
  const open = openMenu === name;
  const setOpen = (next: boolean) =>
    // Closing only closes this one, never another that has taken over.
    setOpenMenu((current) => (next ? name : current === name ? null : current));
  // Whether to move focus into the list as it opens (keyboard only).
  const focusOnOpen = useRef(false);
  // Opened by a click: stays open when the pointer leaves.
  const pinned = useRef(false);
  // Opened from the keyboard: focus returns to the icon on close. Not after
  // a hover or click (fix, set in review): the browser showed its focus
  // ring on the icon when a hovered popover closed.
  const keyboardOpened = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => clearTimer, []);
  // Closed (here, or by another opening): no longer pinned, and any pending
  // timer is dropped.
  useEffect(() => {
    if (!open) {
      pinned.current = false;
      focusOnOpen.current = false;
      clearTimer();
    }
  }, [open]);

  const openNow = () => {
    clearTimer();
    if (open) return;
    keyboardOpened.current = false;
    setOpen(true);
  };
  const closeSoon = () => {
    clearTimer();
    if (pinned.current) return;
    timer.current = setTimeout(() => setOpen(false), HOVER_CLOSE_DELAY_MS);
  };
  const setOpenState = (next: boolean) => {
    clearTimer();
    if (!next) {
      pinned.current = false;
      focusOnOpen.current = false;
    }
    setOpen(next);
  };

  const { Icon } = section;
  const trigger = (
    <button
      type="button"
      className={clsx(
        row ? styles.row : styles.iconItem,
        active && styles.active,
        // Keeps its hover look while its menu shows (set in review; the
        // interim Settings menu's first, then the sections').
        open && styles.menuShowing,
      )}
      aria-label={row ? undefined : section.link.name}
      aria-haspopup="true"
      aria-expanded={open}
      // Not on a touch screen, where a tap also fakes a hover, which would
      // open it just before the tap's click closed it.
      onMouseEnter={tapOpens ? undefined : openNow}
      onMouseLeave={tapOpens ? undefined : closeSoon}
      onFocus={(e) => {
        // Keyboard focus opens it; a click's focus is left to the click.
        if (e.currentTarget.matches(":focus-visible")) {
          keyboardOpened.current = true;
          setOpenState(true);
        }
      }}
      onClick={(e) => {
        // Radix's own toggle on the trigger is skipped: the popover is
        // handled here.
        e.preventDefault();
        // A click goes to the section's first page and closes the popover
        // (set in review; it pinned the popover open). Hover still shows the
        // pages; Enter, Space or → still open the list from the keyboard.
        const first = section.pages[0];
        if (first && !tapOpens) {
          setOpenState(false);
          void router.push(first.href);
          return;
        }
        pinned.current = !open;
        keyboardOpened.current = false;
        setOpenState(!open);
      }}
      onKeyDown={(e) => {
        if (["Enter", " ", "ArrowRight"].includes(e.key)) {
          e.preventDefault();
          focusOnOpen.current = true;
          pinned.current = true;
          keyboardOpened.current = true;
          if (open) {
            // Already showing (from focus): move into the list.
            const first = document.querySelector<HTMLElement>(
              `[data-rail-popover="${section.link.name}"] a`,
            );
            first?.focus();
          } else {
            setOpenState(true);
          }
        }
      }}
    >
      {row ? (
        <>
          <Icon size={ICON_SIZE} className={styles.rowIcon} />
          <span className={styles.rowLabel}>{section.link.name}</span>
        </>
      ) : (
        <Icon size={ICON_SIZE} />
      )}
    </button>
  );

  const pageLink = (page: SidebarLinkProps) => {
    const current = isCurrentPage(page, route);
    return (
      <Link
        key={page.href}
        href={page.href}
        className={clsx(styles.popoverItem, current && styles.current)}
        aria-current={current ? "page" : undefined}
        onClick={() => setOpenState(false)}
      >
        {page.name}
        <PageBadge page={page} />
      </Link>
    );
  };

  return (
    <Popover
      open={open}
      onOpenChange={setOpenState}
      trigger={trigger}
      side="right"
      align={atBottom ? "end" : "start"}
      // 8px past the rail's edge (tried 4px): the item sits 8px inside it.
      sideOffset={16}
      // Its first page level with the hovered icon (set in review; the
      // popover's top was): moved up by what's above that page, the 8px
      // padding, the 28px header and the 1px gap. The page and the icon are
      // both 32px tall.
      // At the bottom, its last page level with the item instead: down by
      // the 12px bottom padding.
      alignOffset={
        atBottom ? -POPOVER_BOTTOM_PADDING_PX : -POPOVER_FIRST_ITEM_OFFSET_PX
      }
      showArrow={false}
      contentClassName={clsx(
        styles.popover,
        section.columns && styles.popoverGroups,
        listTableStyles.menuShadow,
        listTableStyles.menuOutline,
      )}
      // 8px on top, 12px on the other sides (set in review; was none), on
      // the list inside (.popoverBody), not the popover itself (fix, set in
      // review): the hover is tracked on the list, so a pointer in the
      // popover's padding counted as gone, and the menu closed, most easily
      // past the right-hand column of the interim Settings menu. Popover's
      // own padding is inline, so cleared inline.
      contentStyle={{ padding: 0 }}
      onOpenAutoFocus={(e) => {
        if (!focusOnOpen.current) e.preventDefault();
      }}
      onCloseAutoFocus={(e) => {
        if (!keyboardOpened.current) e.preventDefault();
      }}
      content={
        <div
          className={clsx(
            styles.popoverBody,
            section.columns ? styles.popoverColumns : styles.popoverInner,
          )}
          data-rail-popover={section.link.name}
          onMouseEnter={clearTimer}
          onMouseLeave={closeSoon}
        >
          {section.columns ? (
            section.columns.map((column) => (
              <div key={column[0].name} className={styles.popoverColumn}>
                {column.map((group) => (
                  <div
                    key={group.name}
                    className={styles.popoverInner}
                    role="group"
                    aria-label={group.name}
                  >
                    <div className={styles.eyebrow}>{group.name}</div>
                    {group.pages.map(pageLink)}
                  </div>
                ))}
              </div>
            ))
          ) : (
            <>
              <div className={styles.eyebrow}>{section.link.name}</div>
              {section.pages.map(pageLink)}
            </>
          )}
        </div>
      }
    />
  );
}

// An expanded section: a row that opens and closes its pages, as an
// accordion (opening one closes the others).
function ExpandedSection({
  section,
  active,
  open,
  onToggle,
  route,
}: {
  section: Section;
  active: boolean;
  open: boolean;
  onToggle: () => void;
  route: string;
}) {
  const { Icon } = section;
  const listId = `app-rail-${section.link.name.replace(/\W+/g, "-")}`;
  // Grouped pages (the interim Settings menu, as a list here): each group
  // under its name, in the menu's column order.
  const groups: PageGroup[] = section.columns
    ? section.columns.flat()
    : [{ name: "", pages: section.pages }];
  // Opened near the rail's bottom (Settings), the list is scrolled into
  // view once it has opened (its reveal takes 300ms).
  const groupRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open || !section.columns) return;
    const timer = setTimeout(() => {
      groupRef.current?.scrollIntoView({
        block: "nearest",
        behavior: "smooth",
      });
    }, 320);
    return () => clearTimeout(timer);
  }, [open, section.columns]);
  return (
    <div className={styles.sectionGroup} ref={groupRef}>
      <button
        type="button"
        // The current page's section shows as selected, open or closed, as
        // in the collapsed rail (set in review).
        className={clsx(
          styles.row,
          open && styles.openSection,
          active && styles.active,
        )}
        aria-expanded={open}
        aria-controls={listId}
        onClick={onToggle}
      >
        <Icon size={ICON_SIZE} className={styles.rowIcon} />
        <span className={styles.rowLabel}>{section.link.name}</span>
        {/* 12px and bold (set in review; was 14px, regular). One caret,
          turning a quarter to point down as the section opens (set in
          review; it was swapped for a down caret at once). */}
        <PiCaretRightBold
          size={12}
          className={clsx(styles.chevron, open && styles.chevronOpen)}
        />
      </button>
      <div
        id={listId}
        className={styles.subList}
        data-open={open ? "true" : "false"}
      >
        <div className={styles.subListInner}>
          {groups.flatMap((group) => [
            group.name ? (
              <div
                key={`group-${group.name}`}
                className={styles.subGroupLabel}
                aria-hidden="true"
              >
                {group.name}
              </div>
            ) : null,
            ...group.pages.map((page) => {
              const current = isCurrentPage(page, route);
              return (
                <Link
                  key={page.href}
                  href={page.href}
                  className={clsx(styles.subItem, current && styles.current)}
                  aria-current={current ? "page" : undefined}
                  tabIndex={open ? undefined : -1}
                >
                  {page.name}
                  <PageBadge page={page} />
                </Link>
              );
            }),
          ])}
        </div>
      </div>
    </div>
  );
}

// A single-destination item (Search, Upgrade, Settings, Help, the toggle):
// an icon with a tooltip when collapsed, an icon and label when expanded.
function RailItem({
  collapsed,
  Icon,
  label,
  tooltip,
  href,
  external,
  onClick,
  active,
  trailing,
  className,
  tooltipDelay = TOOLTIP_DELAY_MS,
}: {
  collapsed: boolean;
  Icon: IconType;
  label: string;
  tooltip?: string;
  tooltipDelay?: number;
  href?: string;
  external?: boolean;
  onClick?: () => void;
  active?: boolean;
  trailing?: ReactNode;
  className?: string;
}) {
  const classes = clsx(
    collapsed ? styles.iconItem : styles.row,
    active && styles.active,
    className,
  );
  const contents = collapsed ? (
    <Icon size={ICON_SIZE} />
  ) : (
    <>
      <Icon size={ICON_SIZE} className={styles.rowIcon} />
      <span className={styles.rowLabel}>{label}</span>
      {trailing}
    </>
  );
  const a11y = {
    "aria-label": collapsed ? (tooltip ?? label) : undefined,
    "aria-current": active ? ("page" as const) : undefined,
  };
  const element = href ? (
    external ? (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className={classes}
        {...a11y}
      >
        {contents}
      </a>
    ) : (
      <Link href={href} className={classes} {...a11y}>
        {contents}
      </Link>
    )
  ) : (
    <button type="button" className={classes} onClick={onClick} {...a11y}>
      {contents}
    </button>
  );
  return collapsed ? (
    <Tooltip
      content={tooltip ?? label}
      side="right"
      delayDuration={tooltipDelay}
      className={styles.railTooltip}
    >
      {element}
    </Tooltip>
  ) : (
    element
  );
}

// Org custom colours (Settings → Appearance), as on the old sidebar: the
// rail in the primary colour, hover and current in the secondary, text to
// suit. Kept until the redesign decides whether they stay.
function customRailStyle(
  settings: ReturnType<typeof useOrgSettings>,
): CSSProperties | undefined {
  if (!settings?.customized || !settings.primaryColor) return undefined;
  const hex = settings.primaryColor.replace("#", "");
  const full =
    hex.length === 3
      ? hex
          .split("")
          .map((c) => c + c)
          .join("")
      : hex;
  const n = parseInt(full, 16);
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255];
  // http://alienryderflex.com/hsp.html
  const light =
    Math.sqrt(0.299 * r * r + 0.587 * g * g + 0.114 * b * b) > 127.5;
  const text = light ? "#1c1f2e" : "#ffffff";
  return {
    "--rail-bg": settings.primaryColor,
    "--rail-border": "transparent",
    "--rail-hover": settings.secondaryColor || "rgba(255,255,255,.12)",
    "--rail-active": settings.secondaryColor || "rgba(255,255,255,.16)",
    "--rail-text": text,
    "--rail-text-strong": text,
    "--rail-icon": text,
    "--rail-muted": text,
    "--rail-divider": light ? "rgba(0,0,0,.1)" : "rgba(255,255,255,.15)",
    "--rail-keycap": light ? "rgba(0,0,0,.1)" : "rgba(255,255,255,.15)",
  } as CSSProperties;
}

export default function AppRail() {
  const router = useRouter();
  const route = router.route.substring(1);
  const { open: drawerOpen, setOpen: setDrawerOpen } = useSidebarOpen();
  const [collapsedPref, toggleCollapsed] = useRailCollapsed();

  // The drawer (below 1180px) is always expanded.
  const [isNarrow, setIsNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1180px)");
    const update = () => setIsNarrow(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  // Whether the next change of collapsed state animates (below).
  const userToggled = useRef(false);
  // PROTOTYPE ("Docked GrowthBot", set in review): opening the docked
  // GrowthBot rail collapses the side nav, if it's expanded, to leave the
  // page room, as a click on its toggle would (animated, and saved), and
  // it stays collapsed when the rail closes (set in review; it was only
  // while the rail was open, then expanded again).
  const { open: agentOpen } = useAgentPanel();
  const dockedGrowthBot = usePrototypeDockedGrowthBot();
  const dockedOpen = dockedGrowthBot && agentOpen && !isNarrow;
  const wasDockedOpen = useRef(dockedOpen);
  useEffect(() => {
    if (wasDockedOpen.current === dockedOpen) return;
    wasDockedOpen.current = dockedOpen;
    if (dockedOpen && !collapsedPref) {
      userToggled.current = true;
      toggleCollapsed();
    }
  }, [dockedOpen, collapsedPref, toggleCollapsed]);
  const collapsed = collapsedPref && !isNarrow;
  // On <html>, for the rail's width and everything laid out beside it
  // (--app-rail-width). Below 1180px the CSS keeps it expanded.
  useIsomorphicLayoutEffect(() => {
    document.documentElement.classList.toggle(COLLAPSED_CLASS, collapsedPref);
  }, [collapsedPref]);
  useEffect(
    () => () => document.documentElement.classList.remove(COLLAPSED_CLASS),
    [],
  );
  // A touch screen, with no hover (set in review): menus open on a tap.
  const [noHover, setNoHover] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(hover: none)");
    const update = () => setNoHover(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // What the rail shows: icons only, or icons and labels. Collapsing, the
  // labels stay while the rail narrows (its 200ms width transition), then
  // give way to the icons (fix, set in review: they vanished at once, so
  // collapsing looked abrupt beside expanding, where the widening rail
  // reveals them). Expanding, and on load, it follows at once; instant for
  // reduced motion.
  const toggleAnimated = () => {
    userToggled.current = true;
    toggleCollapsed();
  };
  const [contentCollapsed, setContentCollapsed] = useState(collapsed);
  useIsomorphicLayoutEffect(() => {
    const animate = userToggled.current;
    userToggled.current = false;
    if (!collapsed) {
      setContentCollapsed(false);
      return;
    }
    const reducedMotion = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (!animate || reducedMotion) {
      setContentCollapsed(true);
      return;
    }
    const timer = setTimeout(
      () => setContentCollapsed(true),
      RAIL_WIDTH_TRANSITION_MS,
    );
    return () => clearTimeout(timer);
  }, [collapsed]);

  // [ toggles the rail, except while typing or in a menu or dialog. Through
  // a ref, so the listener is bound once and always calls the latest toggle.
  const toggleRef = useRef(toggleAnimated);
  toggleRef.current = toggleAnimated;
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "[" || e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      e.preventDefault();
      toggleRef.current();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const { permissions, superAdmin, organization, canSubscribe } = useUser();
  const { project, segments } = useDefinitions();
  const growthbook = useGrowthBook<AppFeatures>();
  const permissionsUtils = usePermissionsUtil();
  const settings = useOrgSettings();
  const filterProps = buildSidebarLinkFilterProps({
    permissionsUtils,
    permissions,
    superAdmin,
    gb: growthbook,
    project,
    segments,
  });
  const sections = permittedSections(filterProps);
  const interimSettings = usePrototypeInterimSettings();
  const settingsSection = interimSettings
    ? interimSettingsSection(filterProps)
    : null;

  const isActive = (link: SidebarLinkProps) =>
    link.path.test(route) ||
    (link.subLinks || []).some((l) => l.path.test(route));
  const activeSection =
    sections.find((s) => isActive(s.link))?.link.name ?? null;
  // (SDK Configuration's pages no longer count as Settings: it's its own
  // section; set in review.)
  const settingsActive = !!SETTINGS_LINK && isActive(SETTINGS_LINK);

  // Expanded: every section starts closed, and each time the rail expands;
  // the user opens the one they want (set in review; the current page's
  // used to open on its own, on each page change). One open at a time.
  const [openSection, setOpenSection] = useState<string | null>(null);
  useEffect(() => {
    setOpenSection(null);
  }, [collapsed]);

  // The collapsed rail's open section popover, if any: one at a time.
  const [openRailMenu, setOpenRailMenu] = useState<string | null>(null);
  useEffect(() => {
    setOpenRailMenu(null);
  }, [route, collapsed]);

  const [upgradeModal, setUpgradeModal] = useState(false);
  // The same plans that saw the old sidebar's Upgrade button.
  const showUpgrade =
    canSubscribe &&
    permissionsUtils.canManageBilling() &&
    !organization.isVercelIntegration;

  const customLogo =
    settings?.customized && settings?.logoPath ? settings.logoPath : null;

  // PROTOTYPE (set in review): hovering (or keyboard focus on) the logo
  // plays one slow gradient sweep across it (AppRail.module.scss,
  // .logoPlaying), so it reads as clickable. Once per hover (set in
  // review; was repeating while hovered): the pass always finishes, and
  // the next hover plays it again.
  const [logoPlaying, setLogoPlaying] = useState(false);

  return (
    <>
      {upgradeModal && (
        <UpgradeModal
          close={() => setUpgradeModal(false)}
          source="layout"
          commercialFeature={null}
        />
      )}
      <nav
        aria-label="Main"
        className={clsx(styles.rail, {
          [styles.collapsed]: contentCollapsed,
          [styles.drawerOpen]: drawerOpen,
        })}
        style={customRailStyle(settings)}
        onClick={(e) => {
          // A link in the drawer closes it, as before.
          if ((e.target as HTMLElement).closest("a[href]")) {
            setDrawerOpen(false);
          }
        }}
      >
        <Link
          href="/"
          className={clsx(styles.logo, logoPlaying && styles.logoPlaying)}
          // Its name for screen readers; no browser tooltip (set in review;
          // was title="GrowthBook home").
          aria-label="GrowthBook home"
          onMouseEnter={() => setLogoPlaying(true)}
          onFocus={(e) => {
            if (e.currentTarget.matches(":focus-visible")) setLogoPlaying(true);
          }}
          onAnimationEnd={() => setLogoPlaying(false)}
        >
          {/* The brand's logo, drawn in place (GrowthBookLogo.tsx; set in
            review; was the logomark image and a separate wordmark image):
            the mark the same size and in the same place collapsed and
            expanded; expanded, the wordmark beside it at the brand's
            spacing (navy, or white in dark mode). An org's custom logo
            (Settings → Appearance) in place of both. */}
          {customLogo ? (
            <img src={customLogo} alt="" className={styles.customLogo} />
          ) : (
            <GrowthBookLogo
              showWordmark={!contentCollapsed}
              className={styles.brandLogo}
              markClassName={styles.brandMark}
              wordmarkClassName={styles.brandWordmark}
              sweepClassName={styles.sweep}
            />
          )}
        </Link>

        <RailItem
          collapsed={contentCollapsed}
          Icon={SearchIcon}
          label="Search"
          tooltip={`Search (${isMac() ? "⌘K" : "Ctrl+K"})`}
          // After the same brief pause as the bottom items' (set in review).
          tooltipDelay={BOTTOM_TOOLTIP_DELAY_MS}
          onClick={() =>
            document.dispatchEvent(new Event("open-command-palette"))
          }
          trailing={<Keycap>{isMac() ? "⌘K" : "Ctrl K"}</Keycap>}
        />
        <div
          className={clsx(styles.divider, styles.searchDivider)}
          role="separator"
        />

        {sections.map((section) =>
          contentCollapsed ? (
            <CollapsedSection
              key={section.link.name}
              section={section}
              active={activeSection === section.link.name}
              route={route}
              openMenu={openRailMenu}
              setOpenMenu={setOpenRailMenu}
              tapOpens={noHover}
            />
          ) : (
            <ExpandedSection
              key={section.link.name}
              section={section}
              active={activeSection === section.link.name}
              open={openSection === section.link.name}
              onToggle={() => {
                const opening = openSection !== section.link.name;
                setOpenSection(opening ? section.link.name : null);
                // Opening a section goes to its first page (set in review),
                // unless the current page is already in it.
                const first = section.pages[0];
                if (opening && first && activeSection !== section.link.name) {
                  void router.push(first.href);
                }
              }}
              route={route}
            />
          ),
        )}

        <div className={styles.spacer} />

        {showUpgrade ? (
          <RailItem
            collapsed={contentCollapsed}
            Icon={PiArrowCircleUp}
            label="Upgrade"
            onClick={() => setUpgradeModal(true)}
            className={styles.upgrade}
          />
        ) : null}
        {/* PROTOTYPE: with "Interim settings menu" on, a menu of today's
          settings pages, in the collapsed and the expanded rail alike (it
          would be too long to open in place at the bottom): shown on hover
          or keyboard focus, a click going to its first page, as the
          collapsed sections (set in review). */}
        {settingsSection && !contentCollapsed && (isNarrow || noHover) ? (
          // In the drawer (below 1180px) or on a touch screen (set in
          // review): its pages open in place, as the sections above, as a
          // menu that needs a hover wouldn't work there. The rail scrolls,
          // and the list is scrolled into view as it opens.
          <ExpandedSection
            section={settingsSection}
            active={settingsActive}
            open={openSection === settingsSection.link.name}
            onToggle={() => {
              const opening = openSection !== settingsSection.link.name;
              setOpenSection(opening ? settingsSection.link.name : null);
              const first = settingsSection.pages[0];
              if (opening && first && !settingsActive) {
                void router.push(first.href);
              }
            }}
            route={route}
          />
        ) : settingsSection ? (
          <CollapsedSection
            section={settingsSection}
            active={settingsActive}
            route={route}
            openMenu={openRailMenu}
            setOpenMenu={setOpenRailMenu}
            row={!contentCollapsed}
            atBottom
            tapOpens={noHover}
          />
        ) : (
          <RailItem
            collapsed={contentCollapsed}
            // Phosphor's gear-six (set in review; was the gear).
            Icon={SettingsIcon}
            label="Settings"
            href="/settings"
            active={settingsActive}
            tooltipDelay={BOTTOM_TOOLTIP_DELAY_MS}
          />
        )}
        {/* The profile menu (set in review; was the header's avatar), with a
          profile icon. */}
        <ProfileMenu
          railCollapsed={contentCollapsed}
          railClassName={contentCollapsed ? styles.iconItem : styles.row}
          railOpenClassName={styles.menuOpen}
          railLabelClassName={styles.rowLabel}
          railIconSize={ICON_SIZE}
          railIconClassName={contentCollapsed ? undefined : styles.rowIcon}
        />
        {/* Help: a menu of View Docs and Join Slack Community (set in
          review; was a link to the docs). */}
        <HelpMenu
          collapsed={contentCollapsed}
          iconSize={ICON_SIZE}
          triggerClassName={contentCollapsed ? styles.iconItem : styles.row}
          openClassName={styles.menuOpen}
          iconClassName={contentCollapsed ? undefined : styles.rowIcon}
          labelClassName={styles.rowLabel}
        />
        <div
          className={clsx(styles.divider, styles.bottomDivider)}
          role="separator"
        />
        {!isNarrow ? (
          <RailItem
            collapsed={contentCollapsed}
            Icon={PiSidebarSimple}
            label="Collapse"
            // No shortcut shown (set in review; was "[" as a keycap and in
            // the tooltip). The [ key still toggles the rail.
            tooltip="Expand sidebar"
            tooltipDelay={BOTTOM_TOOLTIP_DELAY_MS}
            onClick={toggleAnimated}
            // Its icon flipped while collapsed, so it points the way the
            // rail will go (set in review).
            className={contentCollapsed ? styles.toggleFlipped : undefined}
          />
        ) : null}
      </nav>
    </>
  );
}
