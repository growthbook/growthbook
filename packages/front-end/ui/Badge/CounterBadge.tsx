import { forwardRef } from "react";
import { MarginProps } from "@radix-ui/themes/dist/esm/props/margin.props.js";
import clsx from "clsx";
import styles from "./CounterBadge.module.scss";
import Badge from ".";

type CounterColor = "red" | "amber" | "neutral" | "indigo";

const MAX_COUNT = 99;

type Props = {
  count: string | number;
  color?: CounterColor;
  showFullCount?: boolean;
} & MarginProps;

export default forwardRef<HTMLDivElement, Props>(function CounterBadge(
  { count, color = "neutral", showFullCount = false, ...props }: Props,
  ref,
) {
  const truncated =
    typeof count === "number" && !showFullCount && count > MAX_COUNT;
  const label = truncated ? `${MAX_COUNT}+` : String(count);

  return (
    <Badge
      ref={ref}
      label={label}
      title={truncated ? String(count) : undefined}
      // neutral isn't a Radix accent; the scss override paints it, gray is fallback.
      color={color === "neutral" ? "gray" : color}
      variant="solid"
      radius="full"
      size="xs"
      className={clsx(styles.counterBadge, {
        [styles.neutral]: color === "neutral",
      })}
      {...props}
    />
  );
});
