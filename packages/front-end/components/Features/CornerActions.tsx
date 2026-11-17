import { CSSProperties, ReactNode } from "react";
import { Box, Flex } from "@radix-ui/themes";
import clsx from "clsx";
import styles from "./CornerActions.module.scss";

/** Where a value's action buttons (copy, fullscreen) sit over it. */
export type ActionsOverlay = {
  // Absolute offsets (and gap) against the value's box.
  style?: CSSProperties;
  // Hidden until the value is hovered or focused.
  revealOnHover?: boolean;
  // The value hugs its content rather than spanning its container.
  inline?: boolean;
};

/**
 * A value with its action buttons pinned over one corner. Inside anything with
 * the `hoverActions` class, they're hidden until the value is hovered or
 * focused.
 */
export default function CornerActions({
  overlay,
  actions,
  oneLine = false,
  children,
}: {
  overlay?: ActionsOverlay;
  actions?: ReactNode;
  // A single line, which an inline value keeps clear of its buttons.
  oneLine?: boolean;
  children: ReactNode;
}) {
  const reveal = !!overlay?.revealOnHover;
  return (
    <Box
      position="relative"
      className={clsx(
        styles.value,
        overlay?.inline && styles.inline,
        overlay?.inline && oneLine && actions && styles.room,
        overlay?.inline && !oneLine && styles.lines,
        reveal && styles.hoverActions,
      )}
    >
      {children}
      {actions ? (
        <Flex
          align="center"
          gap="3"
          className={styles.actions}
          style={{
            position: "absolute",
            bottom: 4,
            // Inline, a long value's buttons clear its scrollbar, which runs
            // 4-8px in from the edge.
            right: overlay?.inline ? (oneLine ? 4 : 12) : 16,
            ...overlay?.style,
          }}
        >
          {actions}
        </Flex>
      ) : null}
    </Box>
  );
}
