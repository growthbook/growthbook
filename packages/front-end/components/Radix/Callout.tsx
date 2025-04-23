import clsx from "clsx";
import { Callout as RadixCallout } from "@radix-ui/themes";
import { forwardRef, ReactNode } from "react";
import { MarginProps } from "@radix-ui/themes/dist/esm/props/margin.props.js";
import { Responsive } from "@radix-ui/themes/dist/esm/props/prop-def.js";
import { RadixStatusIcon, Status, getRadixColor, Size } from "./HelperText";
import styles from "./RadixOverrides.module.scss";

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
    fullWidthChildren?: boolean;
  } & MarginProps
>(function Callout(
  {
    children,
    status,
    size = "md",
    icon,
    fullWidthChildren = false,
    ...containerProps
  },
  ref
) {
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
      className={clsx(
        styles.callout,
        fullWidthChildren && styles.fullWidthChildren
      )}
      color={getRadixColor(status)}
      role={status === "error" ? "alert" : undefined}
      size={getRadixSize(size)}
      {...containerProps}
    >
      {renderedIcon ? (
        <RadixCallout.Icon>{renderedIcon}</RadixCallout.Icon>
      ) : null}
      {fullWidthChildren ? (
        children
      ) : (
        <RadixCallout.Text size={getRadixSize(size)}>
          {children}
        </RadixCallout.Text>
      )}
    </RadixCallout.Root>
  );
});
