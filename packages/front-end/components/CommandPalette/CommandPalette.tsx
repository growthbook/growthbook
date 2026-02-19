import { FC, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/router";
import MiniSearch from "minisearch";
import {
  BsSearch,
  BsToggleOn,
  BsGraphUp,
  BsBarChartLine,
} from "react-icons/bs";
import { PiFolderDuotone, PiFlask, PiUsersThree } from "react-icons/pi";
import { getMetricLink } from "shared/experiments";
import Portal from "@/components/Modal/Portal";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useFeaturesNames } from "@/hooks/useFeaturesNames";
import { useExperiments } from "@/hooks/useExperiments";
import { useDashboards } from "@/hooks/useDashboards";
import styles from "./CommandPalette.module.scss";

type CommandPaletteItemType =
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
}

const SECTION_ORDER: CommandPaletteItemType[] = [
  "feature",
  "experiment",
  "metric",
  "savedGroup",
  "dashboard",
];

const SECTION_LABELS: Record<CommandPaletteItemType, string> = {
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
  feature: BsToggleOn,
  experiment: PiFlask,
  metric: BsGraphUp,
  savedGroup: PiUsersThree,
  dashboard: BsBarChartLine,
};

const MAX_PER_SECTION = 5;

const CommandPalette: FC = () => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<Element | null>(null);
  const router = useRouter();

  // Data sources — only fetched once the component mounts (SWR cache)
  const { features } = useFeaturesNames();
  const { experiments } = useExperiments();
  const { metrics, factMetrics, metricGroups, savedGroups } = useDefinitions();
  const { dashboards } = useDashboards(false);

  // Build unified item list
  const items = useMemo<CommandPaletteItem[]>(() => {
    const result: CommandPaletteItem[] = [];

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
        name: e.name,
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
        name: m.name,
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
        name: fm.name,
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
        name: mg.name,
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
        name: sg.groupName,
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
    features,
    experiments,
    metrics,
    factMetrics,
    metricGroups,
    savedGroups,
    dashboards,
  ]);

  // MiniSearch index
  const miniSearch = useMemo(() => {
    const ms = new MiniSearch<CommandPaletteItem>({
      fields: ["name", "description", "tags"],
      storeFields: ["name"],
      searchOptions: {
        boost: { name: 3, description: 1 },
        fuzzy: 0.2,
        prefix: true,
      },
    });
    try {
      ms.addAll(items);
    } catch (e) {
      console.error("CommandPalette: error building search index", e);
    }
    return ms;
  }, [items]);

  // Search results grouped by section
  const groupedResults = useMemo(() => {
    if (!query.trim()) return null;

    const raw = miniSearch.search(query.trim());
    const itemMap = new Map(items.map((i) => [i.id, i]));
    const groups: Record<CommandPaletteItemType, CommandPaletteItem[]> = {
      feature: [],
      experiment: [],
      metric: [],
      savedGroup: [],
      dashboard: [],
    };

    for (const r of raw) {
      const item = itemMap.get(r.id);
      if (!item) continue;
      if (groups[item.type].length < MAX_PER_SECTION) {
        groups[item.type].push(item);
      }
    }

    return groups;
  }, [query, miniSearch, items]);

  // Flat list for keyboard navigation
  const flatResults = useMemo(() => {
    if (!groupedResults) return [];
    const flat: CommandPaletteItem[] = [];
    for (const type of SECTION_ORDER) {
      flat.push(...groupedResults[type]);
    }
    return flat;
  }, [groupedResults]);

  // Reset selection when results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [flatResults]);

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
    setOpen(false);
    setQuery("");
    setSelectedIndex(0);
    if (previousFocusRef.current instanceof HTMLElement) {
      previousFocusRef.current.focus();
    }
  }, []);

  const navigateTo = useCallback(
    (url: string) => {
      closeAndReset();
      router.push(url);
    },
    [router, closeAndReset],
  );

  // Global Cmd/Ctrl+K listener
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

  // Listen for custom event from other UI elements (e.g. TopNav search button)
  useEffect(() => {
    const handler = () => {
      previousFocusRef.current = document.activeElement;
      setOpen(true);
    };
    document.addEventListener("open-command-palette", handler);
    return () => document.removeEventListener("open-command-palette", handler);
  }, []);

  // Lock body scroll and focus input when open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
      // Use nested rAF to ensure Portal has mounted before focusing
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          inputRef.current?.focus();
        });
      });
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

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
            navigateTo(flatResults[selectedIndex].url);
          }
          break;
        case "Escape":
          e.preventDefault();
          closeAndReset();
          break;
      }
    },
    [flatResults, selectedIndex, navigateTo, closeAndReset],
  );

  if (!open) return null;

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
              placeholder="Search features, experiments, metrics..."
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
                const sectionItems = groupedResults[type];
                if (sectionItems.length === 0) return null;
                const SectionIcon = SECTION_ICONS[type];
                return (
                  <div key={type}>
                    <div className={styles.sectionHeader}>
                      {SECTION_LABELS[type]}
                    </div>
                    {sectionItems.map((item) => {
                      const idx = flatIndex++;
                      const Icon = item.icon || SectionIcon;
                      return (
                        <div
                          key={item.id}
                          data-index={idx}
                          className={`${styles.item} ${
                            idx === selectedIndex ? styles.selected : ""
                          }`}
                          onClick={() => navigateTo(item.url)}
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
