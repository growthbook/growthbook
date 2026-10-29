import { FocusEvent, ReactNode, useEffect, useState } from "react";
import Tooltip from "@/ui/Tooltip";
import styles from "./Sidebar.module.scss";

/**
 * Delays the sidebar's Search and bottom-item tooltips, so they don't flash as
 * the pointer passes.
 */
export const BOTTOM_TOOLTIP_DELAY_MS = 300;

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
      <Tooltip
        content={label}
        side="right"
        delayDuration={BOTTOM_TOOLTIP_DELAY_MS}
        className={styles.sidebarTooltip}
        open={open && !menuOpen}
        onOpenChange={setOpen}
      >
        <span className={styles.tooltipAnchor} aria-hidden="true" />
      </Tooltip>
    ),
    triggerProps: {
      onFocus: (e) => {
        if (e.currentTarget.matches(":focus-visible")) setOpen(true);
      },
      onBlur: () => setOpen(false),
    },
  };
}
