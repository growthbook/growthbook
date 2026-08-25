import { Fragment, useEffect, useRef, type ReactNode } from "react";
import styles from "./SuggestionList.module.scss";

export const SUGGESTION_LISTBOX_ID = "chat-composer-suggestions";

export function suggestionOptionId(index: number): string {
  return `${SUGGESTION_LISTBOX_ID}-option-${index}`;
}

export interface SuggestionRow {
  key: string;
  primary: string;
  secondary?: ReactNode;
  /** Heading rendered above the first row of each run of equal labels. */
  groupLabel?: string;
}

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
  emptyLabel: string;
}) {
  const activeRef = useRef<HTMLButtonElement>(null);

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
          <Fragment key={item.key}>
            {item.groupLabel &&
              item.groupLabel !== items[i - 1]?.groupLabel && (
                // Presentational: the listbox's options stay the buttons, and the
                // index the keyboard walks is still the item index.
                <div className={styles.groupLabel} role="presentation">
                  {item.groupLabel}
                </div>
              )}
            <button
              id={suggestionOptionId(i)}
              ref={i === activeIndex ? activeRef : undefined}
              type="button"
              role="option"
              aria-selected={i === activeIndex}
              className={`${styles.row}${i === activeIndex ? ` ${styles.rowActive}` : ""}`}
              onMouseDown={(e) => e.preventDefault()} // keep focus in the editor
              onClick={() => onSelect(i)}
            >
              <span className={styles.name}>{item.primary}</span>
              {item.secondary && (
                <span className={styles.type}>{item.secondary}</span>
              )}
            </button>
          </Fragment>
        ))
      )}
    </div>
  );
}
