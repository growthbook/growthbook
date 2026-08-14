import { useEffect, useRef, type ReactNode } from "react";
import styles from "./SuggestionList.module.scss";

export const SUGGESTION_LISTBOX_ID = "chat-composer-suggestions";

/**
 * Stable per-option id. Focus stays in the editor, so the textbox points at the
 * active option with `aria-activedescendant` — which needs an id it can name.
 */
export function suggestionOptionId(index: number): string {
  return `${SUGGESTION_LISTBOX_ID}-option-${index}`;
}

/** A row in the popup, flattened from whichever kind of suggestion is open. */
export interface SuggestionRow {
  key: string;
  primary: string;
  secondary?: ReactNode;
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
  emptyLabel,
}: {
  items: SuggestionRow[];
  activeIndex: number;
  onSelect: (index: number) => void;
  ariaLabel: string;
  /** Shown when the query matches nothing, so the popup doesn't just vanish. */
  emptyLabel: string;
}) {
  const activeRef = useRef<HTMLButtonElement>(null);

  // Arrowing past either end of the visible window should scroll it into view.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  return (
    <div
      className={styles.popup}
      id={SUGGESTION_LISTBOX_ID}
      role="listbox"
      aria-label={ariaLabel}
    >
      {items.length === 0 ? (
        <div className={styles.empty}>{emptyLabel}</div>
      ) : (
        items.map((item, i) => (
          <button
            key={item.key}
            id={suggestionOptionId(i)}
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
        ))
      )}
    </div>
  );
}
