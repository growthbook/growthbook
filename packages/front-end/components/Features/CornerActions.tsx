import { CSSProperties, ReactNode } from "react";
import { Box, Flex } from "@radix-ui/themes";
import styles from "./CornerActions.module.scss";

/** Where a value's action buttons (copy, fullscreen) sit over it. */
export type ActionsOverlay = {
  // Absolute offsets (and gap) against the value's box.
  style?: CSSProperties;
  // Hidden until the value is hovered or focused.
  revealOnHover?: boolean;
};

/** A value with its action buttons pinned over one corner. */
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
  return (
    <Box
      position="relative"
      className={reveal ? styles.hoverActions : undefined}
    >
      {children}
      {actions ? (
        <Flex
          align="center"
          gap="3"
          className={reveal ? styles.actions : undefined}
          style={{
            position: "absolute",
            bottom: -4,
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
