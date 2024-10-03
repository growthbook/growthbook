import { Callout as RadixCallout } from "@radix-ui/themes";
import { ReactNode } from "react";
import { RadixStatusIcon, Status, getRadixColor } from "./HelperText";
import styles from "./RadixOverrides.module.scss";

export default function Callout({
  children,
  status,
}: {
  children: ReactNode;
  status: Status;
}) {
  return (
    <RadixCallout.Root
      className={styles.callout}
      color={getRadixColor(status)}
      role={status === "error" ? "alert" : undefined}
    >
      <RadixCallout.Icon>
        <RadixStatusIcon status={status} />
      </RadixCallout.Icon>
      <RadixCallout.Text>{children}</RadixCallout.Text>
    </RadixCallout.Root>
  );
}
