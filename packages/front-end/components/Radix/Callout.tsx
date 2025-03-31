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
  } & MarginProps
>(function Callout({ children, status, size = "md", ...containerProps }, ref) {
  return (
    <RadixCallout.Root
      ref={ref}
      className={styles.callout}
      color={getRadixColor(status)}
      role={status === "error" ? "alert" : undefined}
      size={getRadixSize(size)}
      {...containerProps}
    >
      <RadixCallout.Icon>
        <RadixStatusIcon status={status} size={size} />
      </RadixCallout.Icon>
      <RadixCallout.Text size={getRadixSize(size)}>
        {children}
      </RadixCallout.Text>
    </RadixCallout.Root>
  );
});
