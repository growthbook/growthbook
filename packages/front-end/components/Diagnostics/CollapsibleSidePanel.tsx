import { Box, Flex, IconButton } from "@radix-ui/themes";
import {
  PiCaretDown,
  PiCaretLeft,
  PiCaretRight,
  PiCaretUp,
} from "react-icons/pi";
import { ReactNode, useState } from "react";
import styles from "./CollapsibleSidePanel.module.scss";

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
    <Flex
      className={styles.container}
      align="stretch"
      gap="0"
      width="100%"
      style={{ minWidth: 0 }}
    >
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
        <IconButton
          type="button"
          variant="soft"
          color="gray"
          size="1"
          className={styles.toggle}
          onClick={toggle}
          aria-expanded={!collapsed}
          aria-label={collapsed ? `Show ${label}` : `Hide ${label}`}
        >
          <span className={styles.desktopIcon}>
            {collapsed ? (
              <PiCaretRight aria-hidden />
            ) : (
              <PiCaretLeft aria-hidden />
            )}
          </span>
          <span className={styles.mobileIcon}>
            {collapsed ? (
              <PiCaretDown aria-hidden />
            ) : (
              <PiCaretUp aria-hidden />
            )}
          </span>
        </IconButton>
      </Box>
      <Box flexGrow="1" style={{ minWidth: 0 }}>
        {children}
      </Box>
    </Flex>
  );
}
