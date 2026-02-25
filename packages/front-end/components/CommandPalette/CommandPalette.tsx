import { FC, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/router";
import MiniSearch from "minisearch";
import {
  BsSearch,
  BsToggleOn,
  BsGraphUp,
  BsBarChartLine,
  BsFlag,
  BsHouse,
  BsCodeSlash,
  BsClipboardCheck,
  BsGear,
} from "react-icons/bs";
import {
  PiFolderDuotone,
  PiFlask,
  PiUsersThree,
  PiCompass,
} from "react-icons/pi";
import { getMetricLink } from "shared/experiments";
import Portal from "@/components/Modal/Portal";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useFeaturesNames } from "@/hooks/useFeaturesNames";
import { useExperiments } from "@/hooks/useExperiments";
import { useDashboards } from "@/hooks/useDashboards";
import { GBDatabase, GBExperiment, GBSettings } from "@/components/Icons";
import styles from "./CommandPalette.module.scss";

type CommandPaletteItemType =
  | "navigate"
  | "feature"
  | "experiment"
  | "metric"
  | "savedGroup"
  | "dashboard";

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
  "navigate",
  "feature",
  "experiment",
  "metric",
  "savedGroup",
  "dashboard",
];

const SECTION_LABELS: Record<CommandPaletteItemType, string> = {
  navigate: "Pages",
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
  navigate: PiCompass,
  feature: BsToggleOn,
  experiment: PiFlask,
  metric: BsGraphUp,
  savedGroup: PiUsersThree,
  dashboard: BsBarChartLine,
};

const MAX_PER_SECTION = 5;

interface NavigationEntry {
  name: string;
  url: string;
  icon: FC<{ className?: string }>;
  tags: string;
  description?: string;
}

const NAVIGATION_ITEMS: NavigationEntry[] = [
  // Top-level pages
  { name: "Home", url: "/", icon: BsHouse, tags: "home dashboard overview" },
  {
    name: "Features",
    url: "/features",
    icon: BsFlag,
    tags: "feature flags toggles",
  },

  // Experimentation
  {
    name: "Experiments",
    url: "/experiments",
    icon: GBExperiment,
    tags: "experiment ab test",
  },
  {
    name: "Bandits",
    url: "/bandits",
    icon: GBExperiment,
    tags: "bandit multi-armed",
  },
  { name: "Holdouts", url: "/holdouts", icon: GBExperiment, tags: "holdout" },
  {
    name: "Templates",
    url: "/experiments/templates",
    icon: GBExperiment,
    tags: "experiment template",
  },
  {
    name: "Power Calculator",
    url: "/power-calculator",
    icon: GBExperiment,
    tags: "power calculator sample size",
  },
  {
    name: "Namespaces",
    url: "/namespaces",
    icon: GBExperiment,
    tags: "namespace mutual exclusion",
  },

  // Metrics and Data
  {
    name: "Metrics",
    url: "/metrics",
    icon: GBDatabase,
    tags: "metric kpi goal guardrail",
  },
  {
    name: "Fact Tables",
    url: "/fact-tables",
    icon: GBDatabase,
    tags: "fact table sql",
  },
  {
    name: "Segments",
    url: "/segments",
    icon: GBDatabase,
    tags: "segment user group",
  },
  {
    name: "Dimensions",
    url: "/dimensions",
    icon: GBDatabase,
    tags: "dimension breakdown",
  },
  {
    name: "Data Sources",
    url: "/datasources",
    icon: GBDatabase,
    tags: "data source warehouse bigquery snowflake",
  },

  // SDK Configuration
  {
    name: "SDK Connections",
    url: "/sdks",
    icon: BsCodeSlash,
    tags: "sdk connection api",
  },
  {
    name: "Attributes",
    url: "/attributes",
    icon: BsCodeSlash,
    tags: "attribute targeting user",
  },
  {
    name: "Environments",
    url: "/environments",
    icon: BsCodeSlash,
    tags: "environment production dev staging",
  },
  {
    name: "Saved Groups",
    url: "/saved-groups",
    icon: BsCodeSlash,
    tags: "saved group targeting list",
  },
  {
    name: "Archetypes",
    url: "/archetypes",
    icon: BsCodeSlash,
    tags: "archetype persona simulate",
  },

  // Management / Insights
  {
    name: "Dashboard",
    url: "/dashboard",
    icon: BsClipboardCheck,
    tags: "dashboard management overview",
  },
  {
    name: "Presentations",
    url: "/presentations",
    icon: BsClipboardCheck,
    tags: "presentation slide report",
  },
  {
    name: "Ideas",
    url: "/ideas",
    icon: BsClipboardCheck,
    tags: "idea backlog hypothesis",
  },

  // Settings - top level
  {
    name: "General Settings",
    url: "/settings",
    icon: GBSettings,
    tags: "settings general organization config",
    description: "Organization-wide settings",
  },
  {
    name: "Members",
    url: "/settings/team",
    icon: GBSettings,
    tags: "members team invite user people",
    description: "Manage team members",
  },
  {
    name: "Tags",
    url: "/settings/tags",
    icon: GBSettings,
    tags: "tags label category",
  },
  {
    name: "Projects",
    url: "/projects",
    icon: GBSettings,
    tags: "project workspace",
  },
  {
    name: "Custom Fields",
    url: "/settings/customfields",
    icon: GBSettings,
    tags: "custom field metadata",
  },
  {
    name: "API Keys",
    url: "/settings/keys",
    icon: GBSettings,
    tags: "api key secret token",
  },
  {
    name: "Webhooks",
    url: "/settings/webhooks",
    icon: GBSettings,
    tags: "webhook notification event",
  },
  {
    name: "Logs",
    url: "/events",
    icon: GBSettings,
    tags: "log event audit trail activity",
  },
  {
    name: "Billing",
    url: "/settings/billing",
    icon: GBSettings,
    tags: "billing plan subscription payment",
  },

  // Settings - deep links to tabs
  {
    name: "Experiment Settings",
    url: "/settings#experiment",
    icon: BsGear,
    tags: "settings experiment config",
    description: "Settings → Experiment Settings",
  },
  {
    name: "Feature Settings",
    url: "/settings#feature",
    icon: BsGear,
    tags: "settings feature flag config approval",
    description: "Settings → Feature Settings",
  },
  {
    name: "Approval Flow",
    url: "/settings#feature",
    icon: BsGear,
    tags: "approval flow review require",
    description: "Settings → Feature Settings → Approval Flow",
  },
  {
    name: "Metrics & Data Settings",
    url: "/settings#metrics",
    icon: BsGear,
    tags: "settings metrics data north star",
    description: "Settings → Metrics & Data",
  },

  // Settings/Team - deep links
  {
    name: "Teams",
    url: "/settings/team#teams",
    icon: BsGear,
    tags: "teams group permission",
    description: "Members → Teams",
  },
  {
    name: "Roles",
    url: "/settings/team#roles",
    icon: BsGear,
    tags: "roles permission custom rbac",
    description: "Members → Roles",
  },
];

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
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  const { features } = useFeaturesNames();
  const { experiments } = useExperiments();
  const { metrics, factMetrics, metricGroups, savedGroups } = useDefinitions();
  const { dashboards } = useDashboards(false);

  // Build navigation items
  const navigationItems = useMemo<CommandPaletteItem[]>(
    () =>
      NAVIGATION_ITEMS.map((nav) => ({
        id: `navigate::${nav.name}::${nav.url}`,
        type: "navigate" as const,
        name: nav.name,
        description: nav.description || "",
        url: nav.url,
        tags: nav.tags,
        icon: nav.icon,
      })),
    [],
  );

  // Build unified item list
  const items = useMemo<CommandPaletteItem[]>(() => {
    const result: CommandPaletteItem[] = [...navigationItems];

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
    navigationItems,
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
    const emptyGroups = (): Record<
      CommandPaletteItemType,
      CommandPaletteItem[]
    > => ({
      navigate: [],
      feature: [],
      experiment: [],
      metric: [],
      savedGroup: [],
      dashboard: [],
    });

    if (!query.trim()) {
      const groups = emptyGroups();
      groups.navigate = navigationItems;
      return groups;
    }

    const raw = miniSearch.search(query.trim());
    const itemMap = new Map(items.map((i) => [i.id, i]));
    const groups = emptyGroups();

    for (const r of raw) {
      const item = itemMap.get(r.id);
      if (!item) continue;
      if (groups[item.type].length < MAX_PER_SECTION) {
        groups[item.type].push(item);
      }
    }

    return groups;
  }, [query, miniSearch, items, navigationItems]);

  // Flat list for keyboard navigation
  const flatResults = useMemo(() => {
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
    onClose();
  }, [onClose]);

  const navigateTo = useCallback(
    (url: string) => {
      closeAndReset();
      const hashIndex = url.indexOf("#");
      if (hashIndex !== -1) {
        const path = url.substring(0, hashIndex);
        const hash = url.substring(hashIndex + 1);
        const currentPath = router.asPath.split("#")[0].split("?")[0];
        if (currentPath === path) {
          window.location.hash = hash;
          return;
        }
      }
      router.push(url);
    },
    [router, closeAndReset],
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
              placeholder="Search or jump to..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search"
            />
          </div>

          <div className={styles.results} ref={resultsRef}>
            {query.trim() && flatResults.length === 0 && (
              <div className={styles.empty}>No results found</div>
            )}
            {SECTION_ORDER.map((type) => {
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
