import { ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Box, Flex } from "@radix-ui/themes";
import clsx from "clsx";
import styles from "./DetailDrawer.module.scss";

/** Local time, to the millisecond — the table's own column stops at seconds. */
export function formatPreciseTimestamp(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const base = d.toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  return `${base}.${String(d.getMilliseconds()).padStart(3, "0")}`;
}

/**
 * Values carry their type: a string keeps visible quote marks so "12" is not
 * read as a number, while numbers, booleans and null render in teal.
 */
export function TypedValue({ value }: { value: unknown }) {
  if (typeof value === "string") {
    return (
      <span className={styles.value}>
        <span className={styles.quote}>&quot;</span>
        <span className={styles.stringValue}>{value}</span>
        <span className={styles.quote}>&quot;</span>
      </span>
    );
  }
  return (
    <span className={`${styles.value} ${styles.scalarValue}`}>
      {value === null ? "null" : String(value)}
    </span>
  );
}

/**
 * One key column width for every section, so the values line up down the whole
 * drawer rather than stepping left where the keys happen to be shorter.
 *
 * `children` replaces the typed value, for a value that needs its own
 * rendering (a resolved reference, a list); omitted, the value is a TypedValue.
 */
export function DetailRow({
  label,
  value,
  children,
}: {
  label: string;
  value?: unknown;
  children?: ReactNode;
}) {
  return (
    <Flex className={styles.row}>
      <Box className={styles.key}>{label}</Box>
      {children ?? <TypedValue value={value} />}
    </Flex>
  );
}

/**
 * A section heading. `spaced` for every section after the first.
 *
 * `variant="heading"` is a heavier, sentence-case heading for a drawer whose
 * sections carry their own subheadings, so the two levels read apart; the
 * default "label" is the small uppercase label, unchanged.
 */
export function DetailSectionLabel({
  children,
  spaced = false,
  variant = "label",
}: {
  children: ReactNode;
  spaced?: boolean;
  variant?: "label" | "heading";
}) {
  return (
    <Box
      className={clsx(
        variant === "heading" ? styles.sectionHeading : styles.sectionLabel,
        spaced &&
          (variant === "heading"
            ? styles.sectionHeadingSpaced
            : styles.sectionSpaced),
      )}
    >
      {children}
    </Box>
  );
}

/** A section with nothing to show: bare text under its label. */
export function DetailEmpty({ children }: { children: ReactNode }) {
  return <Box className={styles.empty}>{children}</Box>;
}

interface Props {
  /** Whether the drawer is showing. The shell stays mounted either way. */
  open: boolean;
  onClose: () => void;
  /** Element id, for the opener's aria-controls. */
  id?: string;
  ariaLabel: string;
  /**
   * A dimming backdrop that closes the drawer when clicked. On by default.
   * Off for a surface read across rows, where the page behind has to stay
   * visible and clickable while the drawer is open.
   */
  scrim?: boolean;
  /**
   * Changes whenever the drawer's subject changes, so focus moves in again
   * when one open drawer swaps to another record.
   */
  focusKey?: unknown;
  header: ReactNode;
  footer: ReactNode;
  children: ReactNode;
}

/**
 * The detail drawer shell shared by the Event Logs stream and the feature
 * Diagnostics evaluation stream: a 480px panel fixed to the right edge, with
 * header, scrolling body and footer slots. It owns the portal, focus on open
 * and Escape; the caller owns what is shown and when.
 *
 * Mounted for the life of the stream rather than only while open — see the
 * theme-root note below.
 */
export default function DetailDrawer({
  open,
  onClose,
  id,
  ariaLabel,
  scrim = true,
  focusKey,
  header,
  footer,
  children,
}: Props) {
  const drawerRef = useRef<HTMLDivElement>(null);

  // The drawer renders at the Radix Theme root rather than in place. `position:
  // fixed` only resolves against the viewport while no ancestor establishes a
  // containing block — any `transform`, `filter` or `contain` up the tree
  // silently turns it into an absolutely-positioned box that scrolls with the
  // page and slides under the fixed top bar. The same ancestors would also cap
  // the z-index and could clip the drawer with `overflow`.
  //
  // The target is the theme root and not document.body: every colour here is a
  // Radix token, and those are custom properties declared on `.radix-themes`.
  // Outside it they resolve to nothing, so the panel fill drops to transparent
  // and the table shows straight through the drawer. The theme root is high
  // enough to clear the page's own ancestors while still inheriting the tokens,
  // and it declares no transform, contain or isolation of its own — so it
  // neither re-establishes a containing block nor a stacking context, and the
  // z-index still competes with the app chrome exactly as it reads.
  const [themeRoot, setThemeRoot] = useState<Element | null>(null);

  // Runs in an effect because document does not exist during SSR. The element
  // is held here rather than in a wrapper component so it is resolved once for
  // the life of the stream — a wrapper would unmount with the drawer on close
  // and re-render empty on the next open, running the focus effect below
  // against a ref that is still null.
  useEffect(() => {
    setThemeRoot(document.querySelector(".radix-themes") ?? document.body);
  }, []);

  // Focus moves in on open so the drawer is reachable from the keyboard
  // immediately. Focus is returned to the opener by the caller on close.
  useEffect(() => {
    if (open) drawerRef.current?.focus();
  }, [open, focusKey]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open || !themeRoot) return null;

  return createPortal(
    <>
      {/* aria-hidden: the drawer beside it already names what is open, and a
          bare scrim has nothing for a screen reader to announce. Escape closes
          it too, so this is not the only way out. */}
      {scrim && (
        <Box className={styles.overlay} onClick={onClose} aria-hidden />
      )}
      <Box
        ref={drawerRef}
        id={id}
        className={styles.drawer}
        role="region"
        aria-label={ariaLabel}
        tabIndex={-1}
      >
        <Box className={styles.header}>{header}</Box>
        <Box className={styles.body}>{children}</Box>
        <Flex className={styles.footer}>{footer}</Flex>
      </Box>
    </>,
    themeRoot,
  );
}
