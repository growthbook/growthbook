import React, { useCallback, useEffect, useRef, useState } from "react";
import { FaSearch, FaTimes } from "react-icons/fa";
import styles from "./SettingsSearch.module.scss";

export interface SettingsSearchItem {
  id: string;
  tab: string;
  tabLabel: string;
  section: string;
  keywords: string[];
  description: string;
}

export const SETTINGS_SEARCH_ITEMS: SettingsSearchItem[] = [
  {
    id: "settings-experiment-settings",
    tab: "experiment",
    tabLabel: "Experiment Settings",
    section: "Experiment Settings",
    keywords: [
      "experiment",
      "pre-launch checklist",
      "require templates",
      "minimum experiment length",
      "import past experiments",
      "fact table query optimization",
      "multi-metric queries",
      "pre-computed dimension breakdowns",
      "conversion window",
      "attribution model",
      "auto-update frequency",
      "cron schedule",
      "refresh results",
    ],
    description:
      "Pre-launch checklist, templates, import length, query optimization, conversion windows, and auto-update frequency",
  },
  {
    id: "settings-sticky-bucketing",
    tab: "experiment",
    tabLabel: "Experiment Settings",
    section: "Sticky Bucketing",
    keywords: [
      "sticky bucketing",
      "fallback attributes",
      "sdk",
      "bucketing",
      "variation assignment",
    ],
    description:
      "Enable sticky bucketing and fallback attributes for consistent user experiences",
  },
  {
    id: "settings-experiment-health",
    tab: "experiment",
    tabLabel: "Experiment Settings",
    section: "Experiment Health",
    keywords: [
      "health",
      "traffic query",
      "SRM",
      "sample ratio mismatch",
      "p-value threshold",
      "multiple variations",
      "multiple exposure",
    ],
    description:
      "Traffic queries, SRM p-value threshold, and multiple exposure warnings",
  },
  {
    id: "settings-decision-framework",
    tab: "experiment",
    tabLabel: "Experiment Settings",
    section: "Decision Framework",
    keywords: [
      "decision framework",
      "decision criteria",
      "minimum runtime",
      "experiment length",
      "stopping criteria",
    ],
    description:
      "Configure experiment decision framework, runtime limits, and decision criteria",
  },
  {
    id: "settings-experiment-analysis",
    tab: "experiment",
    tabLabel: "Experiment Settings",
    section: "Experiment Analysis",
    keywords: [
      "stats engine",
      "statistics",
      "bayesian",
      "frequentist",
      "confidence level",
      "p-value",
      "sequential testing",
      "CUPED",
      "regression adjustment",
      "variance reduction",
      "post-stratification",
      "analysis",
    ],
    description:
      "Stats engine, Bayesian/Frequentist settings, CUPED, sequential testing, and variance reduction",
  },
  {
    id: "settings-bandit",
    tab: "experiment",
    tabLabel: "Experiment Settings",
    section: "Bandit Settings",
    keywords: [
      "bandit",
      "multi-armed bandit",
      "exploratory stage",
      "update cadence",
      "variation weights",
    ],
    description:
      "Bandit defaults for exploratory stage duration and weight update cadence",
  },
  {
    id: "settings-feature",
    tab: "feature",
    tabLabel: "Feature Settings",
    section: "Feature Settings",
    keywords: [
      "feature",
      "feature flag",
      "secure attributes",
      "salt",
      "feature key",
      "regex validator",
      "kill switch",
      "killswitch",
      "confirmation",
      "require project",
      "rules in all environments",
      "preferred environment",
      "approval flow",
      "require approval",
      "code references",
    ],
    description:
      "Feature key naming, secure attributes, kill switch confirmation, approval flows, and code references",
  },
  {
    id: "settings-metrics",
    tab: "metrics",
    tabLabel: "Metrics & Data",
    section: "Metric Settings",
    keywords: [
      "metric",
      "metric analysis",
      "historical data",
      "minimum metric total",
      "sample size",
      "maximum percentage change",
      "minimum percentage change",
      "minimum detectable effect",
      "MDE",
      "display currency",
      "fact metrics",
      "legacy metrics",
      "metric slices",
    ],
    description:
      "Metric analysis days, behavior defaults, currency, fact metrics, and metric slices",
  },
  {
    id: "settings-datasource",
    tab: "metrics",
    tabLabel: "Metrics & Data",
    section: "Data Source Settings",
    keywords: [
      "data source",
      "datasource",
      "default data source",
      "test query",
      "lookback",
      "query days",
    ],
    description:
      "Default data source selection and test query lookback configuration",
  },
  {
    id: "settings-north-star",
    tab: "metrics",
    tabLabel: "Metrics & Data",
    section: "North Star Metrics",
    keywords: [
      "north star",
      "north star metric",
      "goal metric",
      "key metric",
      "home page metric",
    ],
    description:
      "Configure North Star metrics displayed on the home page with related experiments",
  },
  {
    id: "settings-saved-groups",
    tab: "sdk",
    tabLabel: "SDK Configuration",
    section: "Saved Group Settings",
    keywords: [
      "saved groups",
      "ID list",
      "size limit",
      "sdk payload",
      "group size",
    ],
    description:
      "ID List size limit to control SDK payload size for saved groups",
  },
  {
    id: "settings-import-export",
    tab: "import",
    tabLabel: "Import & Export",
    section: "Import & Export",
    keywords: [
      "import",
      "export",
      "config.yml",
      "yaml",
      "backup",
      "restore",
      "migrate",
      "transfer",
    ],
    description:
      "Import and export organization settings, data sources, metrics, and dimensions",
  },
  {
    id: "settings-custom-markdown",
    tab: "custom",
    tabLabel: "Custom Markdown",
    section: "Custom Markdown",
    keywords: [
      "custom markdown",
      "markdown",
      "feature list",
      "experiment list",
      "metric list",
      "customization",
    ],
    description:
      "Add custom markdown content to feature, experiment, and metric pages",
  },
  {
    id: "settings-ai",
    tab: "ai",
    tabLabel: "AI Settings",
    section: "AI Settings",
    keywords: [
      "AI",
      "artificial intelligence",
      "GPT",
      "Claude",
      "Gemini",
      "OpenAI",
      "Anthropic",
      "prompts",
      "embeddings",
      "model",
      "experiment analysis",
      "hypothesis",
      "text to SQL",
    ],
    description:
      "AI model selection, API keys, custom prompts for analysis, and embeddings",
  },
];

function scoreMatch(item: SettingsSearchItem, query: string): number {
  const q = query.toLowerCase();
  const terms = q.split(/\s+/).filter(Boolean);

  if (terms.length === 0) return 0;

  let totalScore = 0;

  for (const term of terms) {
    let bestTermScore = 0;

    if (item.section.toLowerCase().includes(term)) {
      bestTermScore = Math.max(bestTermScore, 10);
    }
    if (item.section.toLowerCase().startsWith(term)) {
      bestTermScore = Math.max(bestTermScore, 15);
    }

    for (const keyword of item.keywords) {
      const kw = keyword.toLowerCase();
      if (kw === term) {
        bestTermScore = Math.max(bestTermScore, 12);
      } else if (kw.startsWith(term)) {
        bestTermScore = Math.max(bestTermScore, 8);
      } else if (kw.includes(term)) {
        bestTermScore = Math.max(bestTermScore, 5);
      }
    }

    if (item.description.toLowerCase().includes(term)) {
      bestTermScore = Math.max(bestTermScore, 3);
    }

    if (item.tabLabel.toLowerCase().includes(term)) {
      bestTermScore = Math.max(bestTermScore, 2);
    }

    if (bestTermScore === 0) return 0;
    totalScore += bestTermScore;
  }

  return totalScore;
}

interface SettingsSearchProps {
  onNavigate: (tab: string, sectionId: string) => void;
}

export default function SettingsSearch({ onNavigate }: SettingsSearchProps) {
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const results = query.trim()
    ? SETTINGS_SEARCH_ITEMS.map((item) => ({
        item,
        score: scoreMatch(item, query),
      }))
        .filter((r) => r.score > 0)
        .sort((a, b) => b.score - a.score)
        .map((r) => r.item)
    : [];

  const handleSelect = useCallback(
    (item: SettingsSearchItem) => {
      onNavigate(item.tab, item.id);
      setQuery("");
      setIsOpen(false);
      inputRef.current?.blur();
    },
    [onNavigate],
  );

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        // Don't capture Cmd+K since it's used for the command palette
        return;
      }

      if (e.key === "/" && document.activeElement === document.body) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((prev) => Math.min(prev + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Enter" && results[activeIndex]) {
      e.preventDefault();
      handleSelect(results[activeIndex]);
    } else if (e.key === "Escape") {
      setQuery("");
      setIsOpen(false);
      inputRef.current?.blur();
    }
  };

  useEffect(() => {
    if (!dropdownRef.current) return;
    const activeEl = dropdownRef.current.children[activeIndex] as HTMLElement;
    if (activeEl) {
      activeEl.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className={styles.searchContainer} ref={containerRef}>
      <div className={styles.searchInputWrapper}>
        <FaSearch className={styles.searchIcon} />
        <input
          ref={inputRef}
          type="text"
          className={styles.searchInput}
          placeholder="Search settings..."
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleInputKeyDown}
          aria-label="Search settings"
          aria-expanded={isOpen && results.length > 0}
          role="combobox"
          aria-controls="settings-search-results"
          aria-activedescendant={
            results[activeIndex]
              ? `search-result-${results[activeIndex].id}`
              : undefined
          }
        />
        {query && (
          <button
            className={styles.clearButton}
            onClick={() => {
              setQuery("");
              setIsOpen(false);
              inputRef.current?.focus();
            }}
            aria-label="Clear search"
          >
            <FaTimes />
          </button>
        )}
      </div>

      {isOpen && query.trim() && (
        <div
          className={styles.dropdown}
          id="settings-search-results"
          role="listbox"
          ref={dropdownRef}
        >
          {results.length > 0 ? (
            results.map((item, index) => (
              <div
                key={item.id}
                id={`search-result-${item.id}`}
                className={`${styles.resultItem} ${index === activeIndex ? styles.active : ""}`}
                onClick={() => handleSelect(item)}
                onMouseEnter={() => setActiveIndex(index)}
                role="option"
                aria-selected={index === activeIndex}
              >
                <div className={styles.resultContent}>
                  <div className={styles.resultSection}>{item.section}</div>
                  <div className={styles.resultDescription}>
                    {item.description}
                  </div>
                </div>
                <div className={styles.resultTab}>{item.tabLabel}</div>
              </div>
            ))
          ) : (
            <div className={styles.noResults}>
              No settings found for &ldquo;{query}&rdquo;
            </div>
          )}
        </div>
      )}
    </div>
  );
}
