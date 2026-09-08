import { Avatar as RadixAvatar, AvatarProps } from "@radix-ui/themes";
import { MarginProps } from "@radix-ui/themes/dist/esm/props/margin.props.js";
import clsx from "clsx";
import { forwardRef, ReactNode } from "react";
import { radixSize, Size as SharedSize } from "@/ui/sizes";
import styles from "./Avatar.module.scss";

export type Size = SharedSize<"sm" | "md" | "lg">;

export type Props = {
  size?: Size;
  color?: AvatarProps["color"];
  variant?: "solid" | "soft";
  radius?: "full" | "small";
  /** Draw `color` as an outline instead of relying on the fill alone. */
  ring?: boolean;
  children: NonNullable<ReactNode>;
} & MarginProps;

export default forwardRef<HTMLImageElement, Props>(function Avatar(
  {
    size = "md",
    color = "violet",
    variant = "solid",
    radius = "full",
    ring = false,
    children,
    ...otherProps
  }: Props,
  ref,
) {
  return (
    <RadixAvatar
      {...otherProps}
      ref={ref}
      className={clsx(styles.avatar, ring && styles.ring)}
      size={radixSize(size)}
      color={color}
      variant={variant}
      radius={radius}
      fallback={children}
    />
  );
});
