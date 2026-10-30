import { FocusEvent, ReactNode, useEffect, useState } from "react";
import Tooltip from "@/ui/Tooltip";
import styles from "./SidebarTooltip.module.scss";

/**
 * Delays the sidebar's Search and bottom-item tooltips, so they don't flash as
 * the pointer passes.
 */
export const BOTTOM_TOOLTIP_DELAY_MS = 300;

/** A sidebar item's label, shown beside it. */
export function SidebarTooltip({
  content,
  delayDuration = 0,
  open,
  onOpenChange,
  children,
}: {
  content: string;
  delayDuration?: number;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <Tooltip
      content={content}
      side="right"
      delayDuration={delayDuration}
      className={styles.tooltip}
      open={open}
      onOpenChange={onOpenChange}
    >
      {children}
    </Tooltip>
  );
}

/**
 * The item is already the menu's trigger, so render `anchor` as its last child
 * for the tooltip to attach to.
 */
export function useMenuTriggerTooltip({
  label,
  enabled,
  menuOpen,
}: {
  label: string;
  enabled: boolean;
  menuOpen: boolean;
}): {
  anchor: ReactNode;
  triggerProps: {
    onFocus?: (e: FocusEvent<HTMLElement>) => void;
    onBlur?: () => void;
  };
} {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (menuOpen) setOpen(false);
  }, [menuOpen]);

  if (!enabled) return { anchor: null, triggerProps: {} };
  return {
    anchor: (
      <SidebarTooltip
        content={label}
        delayDuration={BOTTOM_TOOLTIP_DELAY_MS}
        open={open && !menuOpen}
        onOpenChange={setOpen}
      >
        <span className={styles.anchor} aria-hidden="true" />
      </SidebarTooltip>
    ),
    triggerProps: {
      onFocus: (e) => {
        if (e.currentTarget.matches(":focus-visible")) setOpen(true);
      },
      onBlur: () => setOpen(false),
    },
  };
}
