import { Callout as RadixCallout } from "@radix-ui/themes";
import { ReactNode } from "react";
import { MarginProps } from "@radix-ui/themes/dist/cjs/props/margin.props";
import { Responsive } from "@radix-ui/themes/dist/cjs/props";
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

export default function Callout({
  children,
  status,
  size = "md",
  ...containerProps
}: {
  children: ReactNode;
  status: Status;
  size?: "sm" | "md";
} & MarginProps) {
  return (
    <RadixCallout.Root
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
}
