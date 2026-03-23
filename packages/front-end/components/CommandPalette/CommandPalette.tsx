import { FC, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/router";
import { useGrowthBook } from "@growthbook/growthbook-react";
import {
  BsSearch,
  BsToggleOn,
  BsGraphUp,
  BsBarChartLine,
  BsDiagram3,
  BsChevronDown,
} from "react-icons/bs";
import { PiFolderDuotone, PiFlask, PiUsersThree } from "react-icons/pi";
import { getMetricLink } from "shared/experiments";
import Portal from "@/components/Modal/Portal";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { isCloud, isMultiOrg } from "@/services/env";
import { AppFeatures } from "@/types/app-features";
import { useFeatureMetaInfo } from "@/hooks/useFeatureMetaInfo";
import { useExperiments } from "@/hooks/useExperiments";
import { useDashboards } from "@/hooks/useDashboards";
import { flattenNavItems, navlinks } from "@/components/Layout/sidebarNav";
import { buildCommandPaletteIndex, combinedSearch } from "./searchUtils";
import styles from "./CommandPalette.module.scss";

type CommandPaletteItemType =
  | "navigation"
  | "feature"
  | "experiment"
  | "metric"
  | "dashboard"
  | "savedGroup";

interface CommandPaletteItem {
  id: string;
  type: CommandPaletteItemType;
  name: string;
  description: string;
  url: string;
  tags: string;
  icon?: FC<{ className?: string }>;
  /** Expands the Pages section instead of navigating */
  action?: "expand-pages";
}

// Pages first so route shortcuts (e.g. "exp" → Experiments) surface before entity hits.
const SECTION_ORDER: CommandPaletteItemType[] = [
  "navigation",
  "feature",
  "experiment",
  "metric",
  "savedGroup",
  "dashboard",
];

const SECTION_LABELS: Record<CommandPaletteItemType, string> = {
  navigation: "Pages",
  feature: "Features",
  experiment: "Experiments",
  metric: "Metrics",
  savedGroup: "Saved Groups",
  dashboard: "Dashboards",
};

const SECTION_ICONS: Record<
  CommandPaletteItemType,
  FC<{ className?: string }>
> = {
  navigation: BsDiagram3,
  feature: BsToggleOn,
  experiment: PiFlask,
  metric: BsGraphUp,
  savedGroup: PiUsersThree,
  dashboard: BsBarChartLine,
};

const MAX_PER_SECTION = 5;
/** Max page matches from search before capping the pool. */
const MAX_NAVIGATION_PER_SECTION = 8;
/** Shown initially under Pages; use "Show more" to reveal up to {@link MAX_NAVIGATION_PER_SECTION}. */
const NAVIGATION_INITIAL_VISIBLE = 3;

const EXPAND_PAGES_ROW_ID = "__palette_expand_pages__";

function getSectionDisplayItems(
  type: CommandPaletteItemType,
  items: CommandPaletteItem[],
  pagesSectionExpanded: boolean,
): CommandPaletteItem[] {
  if (items.length === 0) return [];
  if (
    type === "navigation" &&
    !pagesSectionExpanded &&
    items.length > NAVIGATION_INITIAL_VISIBLE
  ) {
    const hidden = items.length - NAVIGATION_INITIAL_VISIBLE;
    return [
      ...items.slice(0, NAVIGATION_INITIAL_VISIBLE),
      {
        id: EXPAND_PAGES_ROW_ID,
        type: "navigation" as const,
        name: `Show ${hidden} more…`,
        description: "",
        url: "",
        tags: "",
        action: "expand-pages" as const,
      },
    ];
  }
  return items;
}

/**
 * Lightweight wrapper that handles global Cmd/Ctrl+K and custom event listeners.
 * Only mounts the heavy CommandPalette (with data hooks) when the palette is open.
 */
export const CommandPaletteLauncher: FC = () => {
  const [open, setOpen] = useState(false);
  const previousFocusRef = useRef<Element | null>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => {
          if (!prev) {
            previousFocusRef.current = document.activeElement;
          }
          return !prev;
        });
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    const handler = () => {
      previousFocusRef.current = document.activeElement;
      setOpen(true);
    };
    document.addEventListener("open-command-palette", handler);
    return () => document.removeEventListener("open-command-palette", handler);
  }, []);

  if (!open) return null;

  return (
    <CommandPalette
      onClose={() => {
        setOpen(false);
        if (previousFocusRef.current instanceof HTMLElement) {
          previousFocusRef.current.focus();
        }
      }}
    />
  );
};

const CommandPalette: FC<{ onClose: () => void }> = ({ onClose }) => {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [pagesSectionExpanded, setPagesSectionExpanded] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  const { permissions, superAdmin } = useUser();
  const { project, segments, metrics, factMetrics, metricGroups, savedGroups } =
    useDefinitions();
  const growthbook = useGrowthBook<AppFeatures>();
  const permissionsUtils = usePermissionsUtil();

  const { features } = useFeatureMetaInfo();
  const { experiments } = useExperiments();
  const { dashboards } = useDashboards(false);

  // Build unified item list
  const items = useMemo<CommandPaletteItem[]>(() => {
    const filterProps = {
      permissionsUtils,
      permissions,
      superAdmin: !!superAdmin,
      isCloud: isCloud(),
      isMultiOrg: isMultiOrg(),
      gb: growthbook,
      project,
      segments,
    };

    const flatNav = flattenNavItems(navlinks, filterProps);
    const result: CommandPaletteItem[] = flatNav.map((row) => ({
      id: `nav::${row.href}::${row.name}`,
      type: "navigation",
      name: row.name,
      description: row.parentName ?? "",
      url: row.href,
      tags: row.parentName ? `${row.parentName} ${row.name}` : row.name,
    }));

    for (const f of features) {
      if (f.archived) continue;
      result.push({
        id: `feature::${f.id}`,
        type: "feature",
        name: f.id,
        description: "",
        url: `/features/${f.id}`,
        tags: (f.tags || []).join(" "),
      });
    }

    for (const e of experiments) {
      if (e.archived) continue;
      result.push({
        id: `experiment::${e.id}`,
        type: "experiment",
        name: e.name || "",
        description: e.description || "",
        url: `/experiment/${e.id}`,
        tags: (e.tags || []).join(" "),
      });
    }

    for (const m of metrics) {
      if (m.status === "archived") continue;
      result.push({
        id: `metric::${m.id}`,
        type: "metric",
        name: m.name || "",
        description: m.description || "",
        url: getMetricLink(m.id),
        tags: (m.tags || []).join(" "),
      });
    }

    for (const fm of factMetrics) {
      if (fm.archived) continue;
      result.push({
        id: `metric::${fm.id}`,
        type: "metric",
        name: fm.name || "",
        description: fm.description || "",
        url: getMetricLink(fm.id),
        tags: (fm.tags || []).join(" "),
      });
    }

    for (const mg of metricGroups) {
      if (mg.archived) continue;
      result.push({
        id: `metric::mg-${mg.id}`,
        type: "metric",
        name: mg.name || "",
        description: mg.description || "",
        url: `/metric-groups/${mg.id}`,
        tags: (mg.tags || []).join(" "),
        icon: PiFolderDuotone,
      });
    }

    for (const sg of savedGroups) {
      result.push({
        id: `savedGroup::${sg.id}`,
        type: "savedGroup",
        name: sg.groupName || "",
        description: "",
        url: `/saved-groups/${sg.id}`,
        tags: "",
      });
    }

    for (const d of dashboards) {
      if (d.isDeleted) continue;
      result.push({
        id: `dashboard::${d.id}`,
        type: "dashboard",
        name: d.title || d.id,
        description: "",
        url: `/product-analytics/dashboards/${d.id}`,
        tags: "",
      });
    }

    return result;
  }, [
    permissionsUtils,
    permissions,
    superAdmin,
    growthbook,
    project,
    segments,
    features,
    experiments,
    metrics,
    factMetrics,
    metricGroups,
    savedGroups,
    dashboards,
  ]);

  // MiniSearch index
  const miniSearch = useMemo(() => buildCommandPaletteIndex(items), [items]);

  // Search results grouped by section
  const groupedResults = useMemo(() => {
    if (!query.trim()) return null;

    const ordered = combinedSearch(miniSearch, items, query.trim());
    const groups: Record<CommandPaletteItemType, CommandPaletteItem[]> = {
      navigation: [],
      feature: [],
      experiment: [],
      metric: [],
      savedGroup: [],
      dashboard: [],
    };

    for (const item of ordered) {
      const cap =
        item.type === "navigation"
          ? MAX_NAVIGATION_PER_SECTION
          : MAX_PER_SECTION;
      if (groups[item.type].length < cap) {
        groups[item.type].push(item);
      }
    }

    return groups;
  }, [query, miniSearch, items]);

  // Flat list for keyboard navigation (respects Pages collapse + "Show more" row)
  const flatResults = useMemo(() => {
    if (!groupedResults) return [];
    const flat: CommandPaletteItem[] = [];
    for (const type of SECTION_ORDER) {
      flat.push(
        ...getSectionDisplayItems(
          type,
          groupedResults[type],
          pagesSectionExpanded,
        ),
      );
    }
    return flat;
  }, [groupedResults, pagesSectionExpanded]);

  useEffect(() => {
    setPagesSectionExpanded(false);
  }, [query]);

  // Reset selection when the search query or result set changes (not when only expanding Pages)
  useEffect(() => {
    setSelectedIndex(0);
  }, [query, groupedResults]);

  // Scroll selected item into view
  useEffect(() => {
    if (!resultsRef.current) return;
    const selectedEl = resultsRef.current.querySelector(
      `[data-index="${selectedIndex}"]`,
    );
    if (selectedEl) {
      selectedEl.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  const closeAndReset = useCallback(() => {
    onClose();
  }, [onClose]);

  const navigateTo = useCallback(
    (url: string) => {
      closeAndReset();
      router.push(url);
    },
    [router, closeAndReset],
  );

  const activateItem = useCallback(
    (item: CommandPaletteItem) => {
      if (item.action === "expand-pages") {
        setPagesSectionExpanded(true);
        return;
      }
      navigateTo(item.url);
    },
    [navigateTo],
  );

  // Lock body scroll when mounted
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((i) =>
            flatResults.length === 0 ? 0 : (i + 1) % flatResults.length,
          );
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((i) =>
            flatResults.length === 0
              ? 0
              : (i - 1 + flatResults.length) % flatResults.length,
          );
          break;
        case "Enter":
          e.preventDefault();
          if (flatResults[selectedIndex]) {
            activateItem(flatResults[selectedIndex]);
          }
          break;
        case "Escape":
          e.preventDefault();
          closeAndReset();
          break;
      }
    },
    [flatResults, selectedIndex, activateItem, closeAndReset],
  );

  let flatIndex = 0;

  return (
    <Portal>
      <div className={styles.backdrop} onClick={closeAndReset}>
        <div
          className={styles.dialog}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={handleKeyDown}
          role="dialog"
          aria-modal="true"
          aria-label="Command palette"
        >
          <div className={styles.inputWrapper}>
            <BsSearch className={styles.searchIcon} />
            <input
              ref={inputRef}
              className={styles.input}
              type="text"
              autoFocus
              placeholder="Search pages, features, experiments, metrics..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search"
            />
          </div>

          <div className={styles.results} ref={resultsRef}>
            {!query.trim() && (
              <div className={styles.empty}>Start typing to search...</div>
            )}
            {query.trim() && flatResults.length === 0 && (
              <div className={styles.empty}>No results found</div>
            )}
            {groupedResults &&
              SECTION_ORDER.map((type) => {
                const sectionItems = getSectionDisplayItems(
                  type,
                  groupedResults[type],
                  pagesSectionExpanded,
                );
                if (sectionItems.length === 0) return null;
                const SectionIcon = SECTION_ICONS[type];
                return (
                  <div key={type}>
                    <div className={styles.sectionHeader}>
                      {SECTION_LABELS[type]}
                    </div>
                    {sectionItems.map((item) => {
                      const idx = flatIndex++;
                      const Icon =
                        item.action === "expand-pages"
                          ? BsChevronDown
                          : item.icon || SectionIcon;
                      return (
                        <div
                          key={item.id}
                          data-index={idx}
                          className={`${styles.item} ${
                            item.action === "expand-pages"
                              ? styles.showMore
                              : ""
                          } ${idx === selectedIndex ? styles.selected : ""}`}
                          onClick={() => activateItem(item)}
                          onMouseEnter={() => setSelectedIndex(idx)}
                        >
                          <Icon className={styles.itemIcon} />
                          <div className={styles.itemContent}>
                            <div className={styles.itemName}>{item.name}</div>
                            {item.description && (
                              <div className={styles.itemDescription}>
                                {item.description}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
          </div>

          <div className={styles.footer}>
            <span>
              <kbd className={styles.kbd}>&uarr;</kbd>
              <kbd className={styles.kbd}>&darr;</kbd> navigate
            </span>
            <span>
              <kbd className={styles.kbd}>Enter</kbd> open
            </span>
            <span>
              <kbd className={styles.kbd}>Esc</kbd> close
            </span>
          </div>
        </div>
      </div>
    </Portal>
  );
};

export default CommandPalette;
