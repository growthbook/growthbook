import { Avatar as RadixAvatar, AvatarProps } from "@radix-ui/themes";
import { CSSProperties, ReactNode } from "react";
import { Responsive } from "@radix-ui/themes/dist/cjs/props";

type Overwrite<T, NewT> = Omit<T, keyof NewT> & NewT;

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

type Props = Omit<
  Overwrite<
    AvatarProps,
    {
      size?: Size;
      color?: AvatarProps["color"];
      variant?: "solid" | "soft";
      radius?: "full" | "small";
      icon?: ReactNode;
      src?: string;
      children?: ReactNode;
    }
  >,
  "fallback"
>;

export default function Avatar({
  size = "md",
  color = "violet",
  variant = "solid",
  radius = "full",
  icon,
  src,
  children,
  ...otherProps
}: Props) {
  const style: CSSProperties = {
    overflow: "hidden",
    ...(otherProps.style ?? {}),
  };

  if (src) {
    icon = <img src={src} style={{ maxWidth: "100%", maxHeight: "100%" }} />;
  }
  const fallback = icon ?? children ?? "";

  return (
    <RadixAvatar
      {...otherProps}
      size={getRadixSize(size)}
      color={color}
      variant={variant}
      radius={radius}
      fallback={fallback}
      style={style}
    />
  );
}
