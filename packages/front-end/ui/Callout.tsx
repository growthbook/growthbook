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
import clsx from "clsx";
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
    color?: RadixCallout.RootProps["color"]; // Use status instead of color whenever possible
    size?: "sm" | "md";
    icon?: ReactNode | null;
    action?: ReactNode;
    className?: string;
    style?: React.CSSProperties;
    role?: string;
  } & (DismissibleProps | UndismissibleProps) &
    MarginProps
>(function Callout(
  {
    children,
    status,
    color,
    size = "md",
    icon,
    action,
    dismissible = false,
    id,
    renderWhenDismissed,
    className,
    style,
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

  // The icon, action, and dismiss button are each sized to the text's first
  // line and centered within it. They align on that line and never grow the
  // row, so multi-line content stays top-aligned and tall actions (buttons)
  // overflow into the padding instead of pushing the content down.
  const lineHeight =
    size === "sm" ? "var(--line-height-1)" : "var(--line-height-2)";
  const firstLineBox: React.CSSProperties = {
    height: lineHeight,
    display: "flex",
    alignItems: "center",
    flexShrink: 0,
  };

  return (
    <RadixCallout.Root
      ref={ref}
      className={clsx(styles.callout, className)}
      color={color || getRadixColor(status)}
      role={role ?? (status === "error" ? "alert" : undefined)}
      size={getRadixSize(size)}
      {...containerProps}
      style={{
        display: "flex",
        position: "relative",
        ...style,
      }}
      variant="soft"
    >
      {renderedIcon ? (
        <RadixCallout.Icon style={{ height: lineHeight }}>
          {renderedIcon}
        </RadixCallout.Icon>
      ) : null}
      <Flex align="start" gap={action ? "3" : "1"} flexGrow="1">
        {/* Rendered as a div (not the default <p>) so block-level children
            and nested layout don't produce invalid <div>-inside-<p> nesting. */}
        <Text as="div" size={getRadixSize(size)} style={{ flex: 1 }}>
          {children}
        </Text>
        {action ? <Box style={firstLineBox}>{action}</Box> : null}
        {dismissible && id ? (
          <Box style={firstLineBox}>
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
      </Flex>
    </RadixCallout.Root>
  );
});
