import { useEffect, useRef, useState } from "react";
import Tooltip from "@/components/Tooltip/Tooltip";
import styles from "./TruncatedCell.module.scss";

interface Props {
  value: string;
  /**
   * Where the ellipsis goes. "end" (the default) is what every cell had.
   * "middle" keeps the tail visible, for identifiers whose distinguishing part
   * is the end: "gbdemo-chec…ayout-v2" rather than "gbdemo-checkout-layout…".
   */
  truncate?: "end" | "middle";
}

/**
 * Characters pinned at the end in "middle" mode. Pure CSS: the head shrinks
 * with an ellipsis and the tail never does, so it works at any column width
 * without measuring the column.
 */
const MIDDLE_TAIL_CHARS = 10;

/**
 * A stream-table cell value that reveals itself on hover only when it is
 * actually clipped.
 *
 * The condition is measured (`scrollWidth > clientWidth`) rather than guessed
 * from string length, which depends on the font and the column's current share
 * of a percentage-width table. Attaching a tooltip to every cell would put one
 * on values that are already fully visible, which is noise.
 *
 * `usePortal` is not optional here: the stream table's cells are
 * `overflow: hidden` — that is what produces the ellipsis — so a popper
 * rendered as a sibling inside the cell would be clipped by the very rule that
 * made the tooltip necessary.
 */
export default function TruncatedCell({ value, truncate = "end" }: Props) {
  const ref = useRef<HTMLSpanElement>(null);
  const [truncated, setTruncated] = useState(false);

  // Re-measured on resize as well as on value change: the columns are
  // percentage-width, so the same string clips or does not depending on how
  // wide the card currently is.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setTruncated(el.scrollWidth > el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [value]);

  return (
    <Tooltip
      body={value}
      // Always mounted, so the first hover is already answerable; whether it
      // shows anything is the measurement's call.
      shouldDisplay={truncated}
      // Above the value rather than the component's default of below: these are
      // 30px rows, so a tooltip underneath covers the next row down — often the
      // row the reader is about to compare against.
      tipPosition="top"
      usePortal
      className={styles.trigger}
    >
      {truncate === "middle" && value.length > MIDDLE_TAIL_CHARS + 2 ? (
        <span className={styles.middle}>
          {/* The measured box is the head: it is the part that clips. */}
          <span ref={ref} className={styles.text}>
            {value.slice(0, -MIDDLE_TAIL_CHARS)}
          </span>
          <span className={styles.tail}>{value.slice(-MIDDLE_TAIL_CHARS)}</span>
        </span>
      ) : (
        <span ref={ref} className={styles.text}>
          {value}
        </span>
      )}
    </Tooltip>
  );
}
