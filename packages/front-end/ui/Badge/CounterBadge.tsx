import { forwardRef } from "react";
import { MarginProps } from "@radix-ui/themes/dist/esm/props/margin.props.js";
import clsx from "clsx";
import styles from "./CounterBadge.module.scss";
import Badge from ".";

type CounterColor = "red" | "amber" | "slate";

// Numeric counts above this render as "99+" unless showFullCount is set.
const MAX_COUNT = 99;

type Props = {
  count: string | number;
  color?: CounterColor;
  showFullCount?: boolean;
} & MarginProps;

export default forwardRef<HTMLDivElement, Props>(function CounterBadge(
  { count, color = "slate", showFullCount = false, ...props }: Props,
  ref,
) {
  const truncated =
    typeof count === "number" && !showFullCount && count > MAX_COUNT;
  const label = truncated ? `${MAX_COUNT}+` : String(count);

  return (
    <Badge
      ref={ref}
      label={label}
      // Surface the real count on hover when it's been truncated to "99+".
      title={truncated ? String(count) : undefined}
      // "slate" is a gray scale, not a Radix accent color, so it renders via
      // the scss override below; "gray" is the graceful fallback under it.
      color={color === "slate" ? "gray" : color}
      variant="solid"
      radius="full"
      size="xs"
      className={clsx(styles.counterBadge, {
        [styles.slate]: color === "slate",
      })}
      {...props}
    />
  );
});
