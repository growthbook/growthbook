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
import { PiX } from "react-icons/pi";
import clsx from "clsx";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { radixSize } from "@/ui/sizes";
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

export default forwardRef<
  HTMLDivElement,
  {
    children: ReactNode;
    status: Status;
    size?: Size;
    style?: React.CSSProperties;
    icon?: ReactNode | null;
    action?: ReactNode;
    // Aligns the icon against the body only, independent of the action's height.
    align?: "start" | "center";
    // "nowrap" keeps the action on the same line as the body always.
    wrap?: "wrap" | "nowrap";
    role?: string;
  } & (DismissibleProps | UndismissibleProps) &
    MarginProps
>(function Callout(
  {
    children,
    status,
    size = "md",
    style,
    icon,
    action,
    align = "start",
    wrap = "wrap",
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
      size={radixSize(size)}
      {...containerProps}
      style={
        {
          display: "flex",
          alignItems: align === "center" ? "center" : "flex-start",
          position: "relative",
          "--callout-line-height": lineHeight,
          ...style,
        } as React.CSSProperties
      }
      variant="soft"
    >
      <Flex
        wrap={wrap}
        align={align}
        gapX="3"
        gapY="3"
        flexGrow="1"
        minWidth="0"
        justify={action ? "between" : undefined}
      >
        {/* Grouped so icon and body align to each other, not to the action. */}
        <Flex align={align} gap="3" wrap="nowrap" flexGrow="1" minWidth="0">
          {renderedIcon ? (
            <RadixCallout.Icon style={{ height: lineHeight }}>
              {renderedIcon}
            </RadixCallout.Icon>
          ) : null}
          {/* Rendered as a div (not the default <p>) so block-level children
              and nested layout don't produce invalid <div>-inside-<p> nesting. */}
          <Text
            as="div"
            size={radixSize(size)}
            className={clsx(styles.body, action && styles.bodyWithAction)}
          >
            {children}
          </Text>
        </Flex>
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
