import {
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
import UpgradeModal from "@/components/Settings/UpgradeModal";
import { Popover } from "@/ui/Popover";
import Tooltip from "@/ui/Tooltip";
import Badge from "@/ui/Badge";
import { BOTTOM_TOOLTIP_DELAY_MS } from "./railTooltips";
import GrowthBookLogo from "./GrowthBookLogo";
import ProfileMenu from "./ProfileMenu";
import HelpMenu from "./HelpMenu";
import { OPTICAL_STROKE, withOpticalWeight } from "./opticalWeight";
import {
  buildSidebarLinkFilterProps,
  SidebarLinkFilterProps,
  SidebarLinkProps,
} from "./SidebarLink";
import { navlinks } from "./sidebarNav";
import { useSidebarOpen } from "./SidebarOpenProvider";
import styles from "./AppRail.module.scss";

// The app's side nav. Two states, saved per user in this browser: expanded
// (240px, labels; sections are accordions) and collapsed (48px, icons;
// sections open a popover of their pages). The toggle at the bottom switches
// between them. Below 1180px it's an off-canvas drawer, always
// expanded, opened from the header's menu button.
//
// Sections and their pages come from sidebarNav.ts, so permission and
// feature-flag filters, beta badges and ⌘K search stay in sync with it.
// Home isn't a section (the logo links home), and Settings is a single link
// to the Settings page.

const SearchIcon = withOpticalWeight(PiMagnifyingGlass);
const SettingsIcon = withOpticalWeight(PiGearSix);

// Phosphor's regular lightbulb without the highlight inside the bulb,
// thickened as withOpticalWeight does.
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

const SECTION_ICONS: Record<string, IconType> = {
  Features: withOpticalWeight(PiFlagPennant),
  Experimentation: withOpticalWeight(PiFlask),
  "Product Analytics": withOpticalWeight(PiChartLine),
  "Metrics and Data": PiDatabase,
  Insights: LightbulbNoHighlight,
  "SDK Configuration": withOpticalWeight(PiCode),
};
const RAIL_SECTIONS = navlinks.filter((l) => !!SECTION_ICONS[l.name]);
const SETTINGS_LINK = navlinks.find((l) => l.name === "Settings");

const COLLAPSED_CLASS = "app-rail-collapsed";
// Long enough for what follows the switch (the drawer closing, menus moving)
// to land while it's on.
const BREAKPOINT_SWITCH_CLASS = "app-breakpoint-switch";
const BREAKPOINT_SWITCH_MS = 150;
// Matches .rail's width transition (AppRail.module.scss).
const RAIL_WIDTH_TRANSITION_MS = 200;
const ICON_SIZE = 18;
// Leaving a collapsed section waits a moment, so the pointer can cross the
// gap into its popover.
const HOVER_CLOSE_DELAY_MS = 150;

// Runs before paint in the browser, so a saved collapsed rail never flashes
// open, and as a plain effect on the server.
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

const isMac = () =>
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(navigator.userAgent);

// Sets --app-rail-width (global.scss) through .app-rail-collapsed on <html>.
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

function Keycap({ children }: { children: ReactNode }) {
  return (
    <span className={styles.keycap} aria-hidden="true">
      {children}
    </span>
  );
}

type Section = {
  link: SidebarLinkProps;
  Icon: IconType;
  pages: SidebarLinkProps[];
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

function PageBadge({ page }: { page: SidebarLinkProps }) {
  return page.beta ? (
    <Badge color="indigo" label="Beta" variant="soft" size="xs" ml="1" />
  ) : null;
}

// One section's popover shows at a time: the rail holds which.
function CollapsedSection({
  section,
  active,
  route,
  openMenu,
  setOpenMenu,
  tapOpens = false,
}: {
  section: Section;
  active: boolean;
  route: string;
  openMenu: string | null;
  setOpenMenu: Dispatch<SetStateAction<string | null>>;
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
  // Opened by a click or the keyboard: stays open when the pointer leaves.
  const pinned = useRef(false);
  // Opened from the keyboard: focus returns to the icon on close.
  const keyboardOpened = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => clearTimer, []);
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
        styles.iconItem,
        active && styles.active,
        open && styles.menuShowing,
      )}
      aria-label={section.link.name}
      aria-haspopup="true"
      aria-expanded={open}
      // Not on a touch screen, where a tap also fakes a hover.
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
        // The popover is handled here, not by Radix's toggle.
        e.preventDefault();
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
            document
              .querySelector<HTMLElement>(
                `[data-rail-popover="${section.link.name}"] a`,
              )
              ?.focus();
          } else {
            setOpenState(true);
          }
        }
      }}
    >
      <Icon size={ICON_SIZE} />
    </button>
  );

  return (
    <Popover
      open={open}
      onOpenChange={setOpenState}
      trigger={trigger}
      side="right"
      align="start"
      // 8px past the rail's edge: the icon sits 8px inside it.
      sideOffset={16}
      showArrow={false}
      contentClassName={styles.popover}
      // The padding is on the list inside (.popoverBody), so the whole
      // popover counts as hovering it.
      contentStyle={{ padding: 0 }}
      onOpenAutoFocus={(e) => {
        if (!focusOnOpen.current) e.preventDefault();
      }}
      onCloseAutoFocus={(e) => {
        if (!keyboardOpened.current) e.preventDefault();
      }}
      content={
        <div
          className={clsx(styles.popoverBody, styles.popoverInner)}
          data-rail-popover={section.link.name}
          onMouseEnter={clearTimer}
          onMouseLeave={closeSoon}
        >
          <div className={styles.eyebrow}>{section.link.name}</div>
          {section.pages.map((page) => {
            const current = page.path.test(route);
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
          })}
        </div>
      }
    />
  );
}

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
  // The row also goes to the section's first page; the chevron only expands
  // or collapses it.
  onToggle: (navigate: boolean) => void;
  route: string;
}) {
  const { Icon } = section;
  const listId = `app-rail-${section.link.name.replace(/\W+/g, "-")}`;
  return (
    <div className={styles.sectionGroup}>
      <div className={styles.sectionHeader}>
        <button
          type="button"
          className={clsx(
            styles.row,
            styles.sectionRow,
            open && styles.openSection,
            active && styles.active,
          )}
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => onToggle(true)}
        >
          <Icon size={ICON_SIZE} className={styles.rowIcon} />
          <span className={styles.rowLabel}>{section.link.name}</span>
        </button>
        <button
          type="button"
          className={styles.chevronButton}
          aria-label={`${open ? "Collapse" : "Expand"} ${section.link.name}`}
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => onToggle(false)}
        >
          <PiCaretRightBold
            size={12}
            className={clsx(styles.chevron, open && styles.chevronOpen)}
            aria-hidden="true"
          />
        </button>
      </div>
      <div
        id={listId}
        className={styles.subList}
        data-open={open ? "true" : "false"}
      >
        <div className={styles.subListInner}>
          {section.pages.map((page) => {
            const current = page.path.test(route);
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
          })}
        </div>
      </div>
    </div>
  );
}

function RailItem({
  collapsed,
  Icon,
  label,
  tooltip,
  href,
  onClick,
  active,
  trailing,
  className,
  tooltipDelay = 0,
}: {
  collapsed: boolean;
  Icon: IconType;
  label: string;
  tooltip?: string;
  tooltipDelay?: number;
  href?: string;
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
    <Link href={href} className={classes} {...a11y}>
      {contents}
    </Link>
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

export default function AppRail() {
  const router = useRouter();
  const route = router.route.substring(1);
  const { open: drawerOpen, setOpen: setDrawerOpen } = useSidebarOpen();
  const [collapsedPref, toggleCollapsed] = useRailCollapsed();

  // Below 1180px the rail is a drawer, always expanded. Crossing it by
  // resizing switches at once: for a moment no transition runs (global.scss),
  // so nothing slides as the layout changes; one under way ends.
  const [isNarrow, setIsNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1180px)");
    const root = document.documentElement;
    let timer = 0;
    const update = () => setIsNarrow(mq.matches);
    const onChange = () => {
      root.classList.add(BREAKPOINT_SWITCH_CLASS);
      window.clearTimeout(timer);
      timer = window.setTimeout(
        () => root.classList.remove(BREAKPOINT_SWITCH_CLASS),
        BREAKPOINT_SWITCH_MS,
      );
      update();
    };
    update();
    mq.addEventListener("change", onChange);
    return () => {
      mq.removeEventListener("change", onChange);
      window.clearTimeout(timer);
      root.classList.remove(BREAKPOINT_SWITCH_CLASS);
    };
  }, []);
  const collapsed = collapsedPref && !isNarrow;
  useIsomorphicLayoutEffect(() => {
    document.documentElement.classList.toggle(COLLAPSED_CLASS, collapsedPref);
  }, [collapsedPref]);
  useEffect(
    () => () => document.documentElement.classList.remove(COLLAPSED_CLASS),
    [],
  );

  const [noHover, setNoHover] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(hover: none)");
    const update = () => setNoHover(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // Collapsing, the labels stay while the rail narrows; expanding, they
  // follow at once.
  const userToggled = useRef(false);
  const toggleAnimated = () => {
    userToggled.current = true;
    toggleCollapsed();
  };
  const [contentCollapsed, setContentCollapsed] = useState(collapsed);
  // While the rail's width moves, the section rows' chevrons hide, so they
  // never slide over the icons as the rows resize (AppRail.module.scss).
  const [resizing, setResizing] = useState(false);
  useIsomorphicLayoutEffect(() => {
    const animate = userToggled.current;
    userToggled.current = false;
    if (!collapsed) setContentCollapsed(false);
    const reducedMotion = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (!animate || reducedMotion) {
      setContentCollapsed(collapsed);
      setResizing(false);
      return;
    }
    setResizing(true);
    const timer = setTimeout(() => {
      setContentCollapsed(collapsed);
      setResizing(false);
    }, RAIL_WIDTH_TRANSITION_MS);
    return () => clearTimeout(timer);
  }, [collapsed]);

  const { permissions, superAdmin, organization, canSubscribe } = useUser();
  const { project, segments } = useDefinitions();
  const growthbook = useGrowthBook<AppFeatures>();
  const permissionsUtils = usePermissionsUtil();
  const filterProps = buildSidebarLinkFilterProps({
    permissionsUtils,
    permissions,
    superAdmin,
    gb: growthbook,
    project,
    segments,
  });
  const sections = permittedSections(filterProps);

  const isActive = (link: SidebarLinkProps) =>
    link.path.test(route) ||
    (link.subLinks || []).some((l) => l.path.test(route));
  const activeSection =
    sections.find((s) => isActive(s.link))?.link.name ?? null;
  const settingsActive = !!SETTINGS_LINK && isActive(SETTINGS_LINK);

  // Collapsing folds every section, so its pages fold as the rail narrows;
  // expanding unfolds the same ones once it has widened.
  const [openSections, setOpenSections] = useState<string[]>(
    activeSection ? [activeSection] : [],
  );
  const [sectionsFolded, setSectionsFolded] = useState(false);
  const collapsedRef = useRef(collapsed);
  useEffect(() => {
    if (collapsedRef.current === collapsed) return;
    collapsedRef.current = collapsed;
    if (collapsed) {
      setSectionsFolded(true);
      return;
    }
    const reducedMotion = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const timer = setTimeout(
      () => setSectionsFolded(false),
      reducedMotion ? 0 : RAIL_WIDTH_TRANSITION_MS,
    );
    return () => clearTimeout(timer);
  }, [collapsed]);
  useEffect(() => {
    if (!activeSection) return;
    setOpenSections((open) =>
      open.includes(activeSection) ? open : [...open, activeSection],
    );
  }, [activeSection]);
  // Home belongs to no section: arriving on it closes them all, as a fresh
  // load of it does.
  const onHome = route === "";
  useEffect(() => {
    if (onHome) setOpenSections([]);
  }, [onHome]);

  const [openRailMenu, setOpenRailMenu] = useState<string | null>(null);
  useEffect(() => {
    setOpenRailMenu(null);
  }, [route, collapsed]);

  const [upgradeModal, setUpgradeModal] = useState(false);
  const showUpgrade =
    canSubscribe &&
    permissionsUtils.canManageBilling() &&
    !organization.isVercelIntegration;

  // Whether the sections run on below what's shown, for the fade above the
  // bottom group. Checked on scroll and as sections open and close.
  const sectionsRef = useRef<HTMLDivElement>(null);
  const [moreBelow, setMoreBelow] = useState(false);
  const checkMoreBelow = () => {
    const el = sectionsRef.current;
    if (!el) return;
    setMoreBelow(el.scrollTop + el.clientHeight < el.scrollHeight - 1);
  };
  const checkMoreBelowRef = useRef(checkMoreBelow);
  checkMoreBelowRef.current = checkMoreBelow;
  useEffect(() => {
    const el = sectionsRef.current;
    if (!el) return;
    const check = () => checkMoreBelowRef.current();
    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    Array.from(el.children).forEach((child) => observer.observe(child));
    return () => observer.disconnect();
  }, [contentCollapsed]);

  // Each sweep finishes; the next hover plays it again.
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
        id="main-menu"
        aria-label="Main"
        className={clsx(styles.rail, {
          [styles.collapsed]: contentCollapsed,
          [styles.resizing]: resizing,
          // For the logo's wordmark (AppRail.module.scss).
          [styles.collapsing]: resizing && collapsed,
          [styles.drawerOpen]: drawerOpen,
        })}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("a[href]")) {
            setDrawerOpen(false);
          }
        }}
      >
        <Link
          href="/"
          className={clsx(styles.logo, logoPlaying && styles.logoPlaying)}
          aria-label="GrowthBook home"
          onMouseEnter={() => setLogoPlaying(true)}
          onFocus={(e) => {
            if (e.currentTarget.matches(":focus-visible")) setLogoPlaying(true);
          }}
          onAnimationEnd={() => setLogoPlaying(false)}
        >
          <GrowthBookLogo
            showWordmark={!contentCollapsed}
            className={styles.brandLogo}
            markClassName={styles.brandMark}
            wordmarkClassName={styles.brandWordmark}
            sweepClassName={styles.sweep}
          />
        </Link>

        <RailItem
          collapsed={contentCollapsed}
          Icon={SearchIcon}
          label="Search"
          tooltip={`Search (${isMac() ? "⌘K" : "Ctrl+K"})`}
          tooltipDelay={BOTTOM_TOOLTIP_DELAY_MS}
          onClick={() => {
            setDrawerOpen(false);
            document.dispatchEvent(new Event("open-command-palette"));
          }}
          trailing={<Keycap>{isMac() ? "⌘K" : "Ctrl K"}</Keycap>}
        />
        <div
          className={clsx(styles.divider, styles.searchDivider)}
          role="separator"
        />

        {/* Only the sections scroll: the logo, Search and the bottom group
          stay in view however tall they get. */}
        <div
          ref={sectionsRef}
          className={clsx(styles.sections, moreBelow && styles.fadeBottom)}
          onScroll={checkMoreBelow}
        >
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
                open={
                  !sectionsFolded && openSections.includes(section.link.name)
                }
                onToggle={(navigate) => {
                  const opening =
                    sectionsFolded || !openSections.includes(section.link.name);
                  // The row opens only its section; the chevron leaves the
                  // others open.
                  setOpenSections((open) =>
                    !opening
                      ? open.filter((name) => name !== section.link.name)
                      : navigate || sectionsFolded
                        ? [section.link.name]
                        : [...open, section.link.name],
                  );
                  if (opening) setSectionsFolded(false);
                  // Opening a section goes to its first page, unless the
                  // current page is already in it.
                  const first = section.pages[0];
                  if (
                    navigate &&
                    opening &&
                    first &&
                    activeSection !== section.link.name
                  ) {
                    void router.push(first.href);
                  }
                }}
                route={route}
              />
            ),
          )}
        </div>

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
        <RailItem
          collapsed={contentCollapsed}
          Icon={SettingsIcon}
          label="Settings"
          href="/settings"
          active={settingsActive}
          tooltipDelay={BOTTOM_TOOLTIP_DELAY_MS}
        />
        <ProfileMenu
          railCollapsed={contentCollapsed}
          railClassName={contentCollapsed ? styles.iconItem : styles.row}
          railOpenClassName={styles.menuOpen}
          railLabelClassName={styles.rowLabel}
          railIconSize={ICON_SIZE}
          railIconClassName={contentCollapsed ? undefined : styles.rowIcon}
        />
        <HelpMenu
          collapsed={contentCollapsed}
          iconSize={ICON_SIZE}
          triggerClassName={contentCollapsed ? styles.iconItem : styles.row}
          openClassName={styles.menuOpen}
          iconClassName={contentCollapsed ? undefined : styles.rowIcon}
          labelClassName={styles.rowLabel}
        />
        {!isNarrow ? (
          <>
            <div
              className={clsx(styles.divider, styles.bottomDivider)}
              role="separator"
            />
            <RailItem
              collapsed={contentCollapsed}
              Icon={PiSidebarSimple}
              label="Collapse"
              tooltip="Expand sidebar"
              tooltipDelay={BOTTOM_TOOLTIP_DELAY_MS}
              onClick={toggleAnimated}
              // Flipped while collapsed, so it points the way the rail goes.
              className={contentCollapsed ? styles.toggleFlipped : undefined}
            />
          </>
        ) : null}
      </nav>
    </>
  );
}
