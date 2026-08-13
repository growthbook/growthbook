import { useEffect, useRef } from "react";
import type { MentionItem } from "./extensions/metricMention";
import styles from "./MentionList.module.scss";

const TYPE_LABELS: Record<MentionItem["metricType"], string> = {
  metric: "Metric",
  factMetric: "Fact Metric",
  metricGroup: "Metric Group",
};

/**
 * The @-mention popup. Purely presentational — the active index and the
 * keyboard handling live in `ChatComposer`, because the suggestion plugin
 * delivers key events to the editor, not to this list.
 *
 * Anchored above the composer rather than at the caret, which is what the
 * surrounding chat apps do and avoids pulling in a positioning library.
 */
export default function MentionList({
  items,
  activeIndex,
  onSelect,
}: {
  items: MentionItem[];
  activeIndex: number;
  onSelect: (item: MentionItem) => void;
}) {
  const activeRef = useRef<HTMLButtonElement>(null);

  // Arrowing past either end of the visible window should scroll it into view.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  if (!items.length) return null;

  return (
    <div className={styles.popup} role="listbox" aria-label="Metrics">
      {items.map((item, i) => (
        <button
          key={item.id}
          ref={i === activeIndex ? activeRef : undefined}
          type="button"
          role="option"
          aria-selected={i === activeIndex}
          className={`${styles.row}${i === activeIndex ? ` ${styles.rowActive}` : ""}`}
          // The editor still owns the selection, so a click must not blur it.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onSelect(item)}
        >
          <span className={styles.name}>{item.label}</span>
          <span className={styles.type}>{TYPE_LABELS[item.metricType]}</span>
        </button>
      ))}
    </div>
  );
}
