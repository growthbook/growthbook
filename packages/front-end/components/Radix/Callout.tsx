import { Callout as RadixCallout } from "@radix-ui/themes";
import { ReactNode } from "react";
import { MarginProps } from "@radix-ui/themes/dist/cjs/props/margin.props";
import { RadixStatusIcon, Status, getRadixColor } from "./HelperText";
import styles from "./RadixOverrides.module.scss";

type Props = {
  children: ReactNode;
  status: Status;
} & MarginProps;

export default function Callout({
  children,
  status,
  ...containerProps
}: Props) {
  return (
    <RadixCallout.Root
      className={styles.callout}
      color={getRadixColor(status)}
      role={status === "error" ? "alert" : undefined}
      {...containerProps}
    >
      <RadixCallout.Icon>
        <RadixStatusIcon status={status} />
      </RadixCallout.Icon>
      <RadixCallout.Text>{children}</RadixCallout.Text>
    </RadixCallout.Root>
  );
}
