import { CSSProperties, ReactNode } from "react";
import { Box, Flex } from "@radix-ui/themes";
import styles from "./CornerActions.module.scss";

/** Where a value's action buttons (copy, fullscreen) sit over it. */
export type ActionsOverlay = {
  // Absolute offsets (and gap) against the value's box.
  style?: CSSProperties;
  // Hidden until the value is hovered or focused.
  revealOnHover?: boolean;
  // String only: the constant picker joins the actions.
  withConstantButton?: boolean;
};

/** A value with its action buttons pinned over one corner. */
export default function CornerActions({
  overlay,
  position,
  gap,
  actions,
  children,
}: {
  overlay?: ActionsOverlay;
  // Where the actions sit unless the overlay moves them.
  position: CSSProperties;
  gap: "2" | "3";
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
          gap={gap}
          className={reveal ? styles.actions : undefined}
          style={{ position: "absolute", ...position, ...overlay?.style }}
        >
          {actions}
        </Flex>
      ) : null}
    </Box>
  );
}
