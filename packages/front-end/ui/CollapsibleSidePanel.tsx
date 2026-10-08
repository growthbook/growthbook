import { Box, Flex } from "@radix-ui/themes";
import { PiCaretLeft, PiCaretRight } from "react-icons/pi";
import { ReactNode, useState } from "react";
import styles from "./CollapsibleSidePanel.module.scss";

/**
 * A side panel next to its content, with the collapse control sitting on the
 * divider between them. Presentational — the caller owns both sides.
 *
 * Collapsed state is internal unless `collapsed`/`onCollapsedChange` are given,
 * so a caller that needs to persist it can.
 */
export default function CollapsibleSidePanel({
  panel,
  children,
  width = 280,
  label = "filters",
  collapsed: controlledCollapsed,
  onCollapsedChange,
}: {
  panel: ReactNode;
  children: ReactNode;
  width?: number;
  /** Names the panel in the toggle's accessible label, e.g. "show filters". */
  label?: string;
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
}) {
  const [uncontrolled, setUncontrolled] = useState(false);
  const collapsed = controlledCollapsed ?? uncontrolled;

  const toggle = () => {
    const next = !collapsed;
    setUncontrolled(next);
    onCollapsedChange?.(next);
  };

  return (
    <Flex align="stretch" gap="0" width="100%" style={{ minWidth: 0 }}>
      {!collapsed && (
        <Box
          className={styles.panel}
          style={{ width, flex: `0 0 ${width}px` }}
          data-testid="side-panel"
        >
          {panel}
        </Box>
      )}
      <Box className={styles.divider}>
        <button
          type="button"
          className={styles.toggle}
          onClick={toggle}
          aria-expanded={!collapsed}
          aria-label={collapsed ? `Show ${label}` : `Hide ${label}`}
        >
          {collapsed ? (
            <PiCaretRight size={12} aria-hidden />
          ) : (
            <PiCaretLeft size={12} aria-hidden />
          )}
        </button>
      </Box>
      {/* minWidth:0 or a wide table stretches the flex item instead of scrolling. */}
      <Box flexGrow="1" style={{ minWidth: 0 }}>
        {children}
      </Box>
    </Flex>
  );
}
