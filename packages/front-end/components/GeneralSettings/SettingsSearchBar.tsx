import React, {
  useState,
  useRef,
  useCallback,
  useEffect,
  useMemo,
} from "react";
import { BsSearch, BsXLg } from "react-icons/bs";
import styles from "./SettingsSearchBar.module.scss";

export interface SettingsSearchItem {
  id: string;
  label: string;
  keywords: string[];
  tab: string | null;
  tabLabel: string;
}

interface Props {
  items: SettingsSearchItem[];
  onNavigate: (tab: string | null, sectionId: string) => void;
}

function matchesQuery(item: SettingsSearchItem, query: string): boolean {
  const q = query.toLowerCase();
  if (item.label.toLowerCase().includes(q)) return true;
  if (item.tabLabel.toLowerCase().includes(q)) return true;
  return item.keywords.some((kw) => kw.toLowerCase().includes(q));
}

export default function SettingsSearchBar({ items, onNavigate }: Props) {
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(
    () =>
      query.trim()
        ? items.filter((item) => matchesQuery(item, query.trim()))
        : [],
    [query, items],
  );

  const handleSelect = useCallback(
    (item: SettingsSearchItem) => {
      onNavigate(item.tab, item.id);
      setQuery("");
      setIsOpen(false);
      inputRef.current?.blur();
    },
    [onNavigate],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!isOpen || filtered.length === 0) return;

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setActiveIndex((prev) => Math.min(prev + 1, filtered.length - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setActiveIndex((prev) => Math.max(prev - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          if (filtered[activeIndex]) {
            handleSelect(filtered[activeIndex]);
          }
          break;
        case "Escape":
          e.preventDefault();
          setIsOpen(false);
          inputRef.current?.blur();
          break;
      }
    },
    [isOpen, filtered, activeIndex, handleSelect],
  );

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    if (!listRef.current) return;
    const activeEl = listRef.current.children[activeIndex] as HTMLElement;
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
      <span className={styles.searchIcon}>
        <BsSearch size={14} />
      </span>
      <input
        ref={inputRef}
        className={styles.searchInput}
        type="text"
        placeholder='Search settings... (e.g. "stats engine", "SRM", "north star")'
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setIsOpen(true);
        }}
        onFocus={() => {
          if (query.trim()) setIsOpen(true);
        }}
        onKeyDown={handleKeyDown}
        aria-label="Search settings"
        aria-expanded={isOpen && query.trim().length > 0}
        aria-controls="settings-search-results"
        role="combobox"
        aria-autocomplete="list"
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
          <BsXLg size={12} />
        </button>
      )}
      {isOpen && query.trim() && (
        <div
          className={styles.dropdown}
          id="settings-search-results"
          role="listbox"
          ref={listRef}
        >
          {filtered.length > 0 ? (
            <>
              <div className={styles.hint}>
                {filtered.length} result{filtered.length !== 1 ? "s" : ""} —
                press Enter to jump
              </div>
              {filtered.map((item, i) => (
                <div
                  key={item.id}
                  className={`${styles.dropdownItem} ${i === activeIndex ? styles.active : ""}`}
                  onClick={() => handleSelect(item)}
                  onMouseEnter={() => setActiveIndex(i)}
                  role="option"
                  aria-selected={i === activeIndex}
                >
                  <span className={styles.itemLabel}>{item.label}</span>
                  <span className={styles.itemTab}>{item.tabLabel}</span>
                </div>
              ))}
            </>
          ) : (
            <div className={styles.noResults}>
              No settings found for &ldquo;{query.trim()}&rdquo;
            </div>
          )}
        </div>
      )}
    </div>
  );
}
