import clsx from "clsx";
import { ReactNode, TransitionEvent, useState } from "react";
import { PiCaretDown, PiCaretRight } from "react-icons/pi";
import styles from "./Collapse.module.scss";

/** Content that slides open and shut; mounted on first open, untabbable shut. */
export default function Collapse({
  open,
  children,
}: {
  open: boolean;
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
