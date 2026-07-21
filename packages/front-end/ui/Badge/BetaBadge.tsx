import { forwardRef } from "react";
import { MarginProps } from "@radix-ui/themes/dist/esm/props/margin.props.js";
import styles from "./BetaBadge.module.scss";
import Badge from ".";

type Props = {
  size?: "xs" | "sm";
} & MarginProps;

export default forwardRef<HTMLDivElement, Props>(function BetaBadge(
  { size = "xs", ...props }: Props,
  ref,
) {
  return (
    <Badge
      ref={ref}
      label="Beta"
      color="gray"
      variant="solid"
      size={size}
      className={styles.betaBadge}
      {...props}
    />
  );
});
