import { FocusEvent, ReactNode, useEffect, useState } from "react";
import Tooltip from "@/ui/Tooltip";
import styles from "./AppRail.module.scss";

// The side nav's Search and bottom items' tooltips show after a brief
// pause, so they don't flash up as the pointer passes by.
export const BOTTOM_TOOLTIP_DELAY_MS = 300;

// The item is the menu's trigger, so the tooltip anchors on a layer over it
// (`anchor`, the item's last child).
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
        className={styles.railTooltip}
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
