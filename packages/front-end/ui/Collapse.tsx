import clsx from "clsx";
import { CSSProperties, ReactNode, TransitionEvent, useState } from "react";
import { PiCaretDown, PiCaretRight } from "react-icons/pi";
import Link from "./Link";
import styles from "./Collapse.module.scss";

/** Content that slides open and shut; mounted on first open, untabbable shut. */
export default function Collapse({
  open,
  duration,
  children,
}: {
  open: boolean;
  // In ms; 200 by default.
  duration?: number;
  children: ReactNode;
}) {
  const [opened, setOpened] = useState(open);
  const [settled, setSettled] = useState(open);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    setSettled(false);
    if (open) setOpened(true);
  }
  const onTransitionEnd = (e: TransitionEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.propertyName === "grid-template-rows" && open) setSettled(true);
  };
  return (
    <div
      className={clsx(styles.collapse, !open && styles.closed)}
      style={
        duration === undefined
          ? undefined
          : ({ "--collapse-duration": `${duration}ms` } as CSSProperties)
      }
      onTransitionEnd={onTransitionEnd}
    >
      <div className={clsx(styles.inner, open && settled && styles.unclipped)}>
        {opened ? children : null}
      </div>
    </div>
  );
}

/** The row that opens and shuts a Collapse, tinted on hover. */
export function CollapseTrigger({
  open,
  onOpenChange,
  caret = "end",
  action,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  caret?: "start" | "end";
  /** Follows the toggle without toggling, or ends the row if the caret doesn't. */
  action?: ReactNode;
  children: ReactNode;
}) {
  const icon = (
    <span className={clsx(styles.caret, caret === "end" && styles.atEnd)}>
      {open ? <PiCaretDown /> : <PiCaretRight />}
    </span>
  );
  return (
    <div className={styles.trigger}>
      <button
        type="button"
        className={styles.toggle}
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
      >
        {caret === "start" ? icon : null}
        {children}
      </button>
      {action ? (
        <span
          className={clsx(styles.action, caret === "start" && styles.atEnd)}
        >
          {action}
        </span>
      ) : null}
      {caret === "end" ? icon : null}
    </div>
  );
}

/** A link that opens and shuts a Collapse, for where a row is too heavy. */
export function CollapseLink({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <Link
      size="sm"
      aria-expanded={open}
      onClick={(e) => {
        e.preventDefault();
        onOpenChange(!open);
      }}
    >
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
        {children}
        {open ? <PiCaretDown /> : <PiCaretRight />}
      </span>
    </Link>
  );
}
