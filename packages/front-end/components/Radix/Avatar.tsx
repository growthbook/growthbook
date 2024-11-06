import { Avatar as RadixAvatar, AvatarProps } from "@radix-ui/themes";
import { Responsive } from "@radix-ui/themes/dist/cjs/props";
import { MarginProps } from "@radix-ui/themes/dist/cjs/props/margin.props";
import { ReactNode } from "react";
import styles from "./RadixOverrides.module.scss";

export type Size = "sm" | "md" | "lg";

export function getRadixSize(size: Size): Responsive<"1" | "2" | "3"> {
  switch (size) {
    case "sm":
      return "1";
    case "md":
      return "2";
    case "lg":
      return "3";
  }
}

export type Props = {
  size?: Size;
  color?: AvatarProps["color"];
  variant?: "solid" | "soft";
  radius?: "full" | "small";
  children: NonNullable<ReactNode>;
} & MarginProps;

export default function Avatar({
  size = "md",
  color = "violet",
  variant = "solid",
  radius = "full",
  children,
  ...otherProps
}: Props) {
  return (
    <RadixAvatar
      {...otherProps}
      className={styles.avatar}
      size={getRadixSize(size)}
      color={color}
      variant={variant}
      radius={radius}
      fallback={children}
    />
  );
}
