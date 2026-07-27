import {
  Callout as RadixCallout,
  Box,
  Flex,
  IconButton,
  Text,
  Tooltip,
} from "@radix-ui/themes";
import React, { forwardRef, ReactNode } from "react";
import { MarginProps } from "@radix-ui/themes/dist/esm/props/margin.props.js";
import { Responsive } from "@radix-ui/themes/dist/esm/props/prop-def.js";
import { PiX } from "react-icons/pi";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { RadixStatusIcon, Status, getRadixColor, Size } from "./HelperText";
import styles from "./Callout.module.scss";

type DismissibleProps = {
  dismissible: true;
  id: string;
  renderWhenDismissed?: (undismiss: () => void) => React.ReactElement;
};

type UndismissibleProps = {
  dismissible?: false;
  id?: string;
  renderWhenDismissed?: never;
};

export function getRadixSize(size: Size): Responsive<"1" | "2"> {
  switch (size) {
    case "sm":
      return "1";
    case "md":
      return "2";
  }
}

export default forwardRef<
  HTMLDivElement,
  {
    children: ReactNode;
    status: Status;
    size?: "sm" | "md";
    icon?: ReactNode | null;
    action?: ReactNode;
    role?: string;
  } & (DismissibleProps | UndismissibleProps) &
    MarginProps
>(function Callout(
  {
    children,
    status,
    size = "md",
    icon,
    action,
    dismissible = false,
    id,
    renderWhenDismissed,
    role,
    ...containerProps
  },
  ref,
) {
  const [dismissed, setDismissed] = useLocalStorage(`callout:${id}`, false);

  if (dismissible && dismissed && id) {
    return renderWhenDismissed
      ? renderWhenDismissed(() => setDismissed(false))
      : null;
  }

  const renderedIcon = (() => {
    if (icon === null) {
      return null; // Render no icon if icon prop is null
    }
    if (icon !== undefined) {
      return icon; // Render custom icon if provided
    }
    // Otherwise render the default icon
    return <RadixStatusIcon status={status} size={size} />;
  })();

  const lineHeight =
    size === "sm" ? "var(--line-height-1)" : "var(--line-height-2)";

  return (
    <RadixCallout.Root
      ref={ref}
      className={styles.callout}
      color={getRadixColor(status)}
      role={
        role ??
        (status === "error" || status === "attention" ? "alert" : undefined)
      }
      size={getRadixSize(size)}
      {...containerProps}
      style={
        {
          display: "flex",
          position: "relative",
          "--callout-line-height": lineHeight,
        } as React.CSSProperties
      }
      variant="soft"
    >
      {renderedIcon ? (
        <RadixCallout.Icon style={{ height: lineHeight }}>
          {renderedIcon}
        </RadixCallout.Icon>
      ) : null}
      <Flex
        wrap="wrap"
        align="start"
        gapX="3"
        gapY="2"
        flexGrow="1"
        minWidth="0"
      >
        {/* Rendered as a div (not the default <p>) so block-level children
            and nested layout don't produce invalid <div>-inside-<p> nesting. */}
        <Text as="div" size={getRadixSize(size)} className={styles.body}>
          {children}
        </Text>
        {action ? <Box className={styles.firstLineSlot}>{action}</Box> : null}
      </Flex>
      {dismissible && id ? (
        <Box className={styles.firstLineSlot}>
          <Tooltip content="Dismiss">
            <IconButton
              variant="ghost"
              color="gray"
              size="1"
              onClick={() => setDismissed(true)}
              aria-label="Dismiss"
            >
              <PiX />
            </IconButton>
          </Tooltip>
        </Box>
      ) : null}
    </RadixCallout.Root>
  );
});
