import { useEffect, useRef } from "react";
import styles from "./SuggestionList.module.scss";

/** A row in the popup, flattened from whichever kind of suggestion is open. */
export interface SuggestionRow {
  key: string;
  primary: string;
  secondary?: string;
}

/**
 * The popup shared by the `@` and `/` menus. Purely presentational — the
 * active index and the keyboard handling live in `ChatComposer`, because the
 * suggestion plugin delivers key events to the editor, not to this list.
 *
 * Anchored above the composer rather than at the caret, which is what the
 * surrounding chat apps do and avoids pulling in a positioning library.
 */
export default function SuggestionList({
  items,
  activeIndex,
  onSelect,
  ariaLabel,
}: {
  items: SuggestionRow[];
  activeIndex: number;
  onSelect: (index: number) => void;
  ariaLabel: string;
}) {
  const activeRef = useRef<HTMLButtonElement>(null);

  // Arrowing past either end of the visible window should scroll it into view.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  if (!items.length) return null;

  return (
    <div className={styles.popup} role="listbox" aria-label={ariaLabel}>
      {items.map((item, i) => (
        <button
          key={item.key}
          ref={i === activeIndex ? activeRef : undefined}
          type="button"
          role="option"
          aria-selected={i === activeIndex}
          className={`${styles.row}${i === activeIndex ? ` ${styles.rowActive}` : ""}`}
          // The editor still owns the selection, so a click must not blur it.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onSelect(i)}
        >
          <span className={styles.name}>{item.primary}</span>
          {item.secondary && (
            <span className={styles.type}>{item.secondary}</span>
          )}
        </button>
      ))}
    </div>
  );
}
