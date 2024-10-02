import { Callout as RadixCallout } from "@radix-ui/themes";
import { ReactNode } from "react";
import { RadixStatusIcon, Status, getRadixColor } from "./HelperText";
import styles from "./RadixOverrides.module.scss";

export default function Callout({
  children,
  type,
}: {
  children: ReactNode;
  type: Status;
}) {
  return (
    <RadixCallout.Root
      className={styles.callout}
      color={getRadixColor(type)}
      role={type === "error" ? "alert" : undefined}
    >
      <RadixCallout.Icon>
        <RadixStatusIcon status={type} />
      </RadixCallout.Icon>
      <RadixCallout.Text>{children}</RadixCallout.Text>
    </RadixCallout.Root>
  );
}
