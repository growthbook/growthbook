import { Button as RadixButton, ButtonProps, Text } from "@radix-ui/themes";
import { CSSProperties, ReactNode } from "react";
import { Responsive } from "@radix-ui/themes/dist/cjs/props";
import Link from "next/link";
import ConditionalWrapper from "@/components/ConditionalWrapper";

type Overwrite<T, NewT> = Omit<T, keyof NewT> & NewT;

export type Color = "primary" | "danger";
export type Variant = "solid" | "soft" | "outline" | "ghost";
export type Size = "xs" | "sm" | "md";

export type Props = Overwrite<
  ButtonProps,
  {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onClick?: (e: any) => void;
    href?: string;
    color?: Color | ButtonProps["color"];
    variant?: Variant;
    size?: Size;
    disabled?: boolean;
    loading?: boolean;
    children: ReactNode;
  }
>;

export function getRadixColor(
  color: Color | ButtonProps["color"]
): ButtonProps["color"] {
  switch (color) {
    case "primary":
      return "violet";
    case "danger":
      return "red";
    default:
      return color;
  }
}

export function getRadixSize(size: Size): Responsive<"1" | "2" | "3"> {
  switch (size) {
    case "xs":
      return "1";
    case "sm":
      return "2";
    case "md":
      return "3";
  }
}

export default function Button({
  onClick,
  href,
  color = "primary",
  variant = "solid",
  size = "md",
  disabled,
  loading,
  children,
  ...otherProps
}: Props) {
  const radixSize = getRadixSize(size);
  let style: CSSProperties = {};
  if (variant === "ghost") {
    // hack to make ghost buttons have proper margins / padding
    style = {
      margin: 0,
      height: "var(--base-button-height)",
      paddingTop: 0,
      paddingBottom: 0,
      paddingLeft: `var(--space-${parseInt(radixSize as string) + 1})`,
      paddingRight: `var(--space-${parseInt(radixSize as string) + 1})`,
    };
  }
  if (otherProps.style) {
    style = Object.assign(style, otherProps.style);
  }

  return (
    <ConditionalWrapper
      condition={!!href}
      wrapper={<Link href={href ?? "#"} />}
    >
      <RadixButton
        onClick={onClick}
        color={getRadixColor(color)}
        variant={variant}
        size={radixSize}
        disabled={disabled}
        loading={loading}
        style={style}
        {...otherProps}
      >
        <Text weight="medium">{children}</Text>
      </RadixButton>
    </ConditionalWrapper>
  );
}
