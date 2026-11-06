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
  // The value hugs its content and the buttons follow it, at its foot,
  // rather than sitting over its container's corner.
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
  children,
}: {
  overlay?: ActionsOverlay;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const reveal = !!overlay?.revealOnHover;
  if (overlay?.inline) {
    return (
      <Flex
        align="end"
        gap="2"
        className={clsx(styles.value, reveal && styles.hoverActions)}
      >
        <Box minWidth="0">{children}</Box>
        {actions ? (
          <Flex
            align="center"
            gap="3"
            flexShrink="0"
            className={styles.actions}
          >
            {actions}
          </Flex>
        ) : null}
      </Flex>
    );
  }
  return (
    <Box
      position="relative"
      className={clsx(styles.value, reveal && styles.hoverActions)}
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
            right: 16,
            ...overlay?.style,
          }}
        >
          {actions}
        </Flex>
      ) : null}
    </Box>
  );
}
