import { Callout as RadixCallout, Box, IconButton } from "@radix-ui/themes";
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
    contentsAs?: "text" | "div";
    variant?: "soft" | "surface" | "outline";
  } & (DismissibleProps | UndismissibleProps) &
    MarginProps
>(function Callout(
  {
    children,
    status,
    size = "md",
    icon,
    contentsAs = "text",
    dismissible = false,
    id,
    renderWhenDismissed,
    variant = "soft",
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

  return (
    <RadixCallout.Root
      ref={ref}
      className={styles.callout}
      color={getRadixColor(status)}
      role={status === "error" ? "alert" : undefined}
      size={getRadixSize(size)}
      {...containerProps}
      style={{
        position: "relative",
      }}
      variant={variant}
    >
      {renderedIcon ? (
        <RadixCallout.Icon>{renderedIcon}</RadixCallout.Icon>
      ) : null}
      {contentsAs === "div" ? (
        <Box>
          <div>{children}</div>
        </Box>
      ) : (
        <>
          <RadixCallout.Text size={getRadixSize(size)}>
            {children}
          </RadixCallout.Text>
          {dismissible && id ? (
            <IconButton
              variant="ghost"
              color="gray"
              size="1"
              onClick={() => setDismissed(true)}
              aria-label="Dismiss"
              style={{
                position: "absolute",
                right: 8,
                top: "50%",
                marginTop: -11,
              }}
            >
              <PiX />
            </IconButton>
          ) : null}
        </>
      )}
    </RadixCallout.Root>
  );
});
