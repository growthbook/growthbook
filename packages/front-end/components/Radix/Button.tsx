import { Button as RadixButton, ButtonProps, Strong } from "@radix-ui/themes";
import { ReactNode } from "react";
import { Responsive } from "@radix-ui/themes/dist/cjs/props";

type Overwrite<T, NewT> = Omit<T, keyof NewT> & NewT;

export type Theme = "primary" | "danger";
export type Variant = "solid" | "soft" | "outline" | "ghost";
export type Size = "sm" | "md" | "lg";

export type Props = Overwrite<
  ButtonProps,
  {
    onClick?: () => void;
    theme?: Theme;
    variant?: Variant;
    size?: Size;
    disabled?: boolean;
    loading?: boolean;
    children: ReactNode;
  }
>;

export function getRadixColor(theme: Theme): ButtonProps["color"] {
  switch (theme) {
    case "primary":
      return "violet";
    case "danger":
      return "red";
  }
}

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

export default function Button({
  onClick,
  theme = "primary",
  variant = "solid",
  size = "md",
  disabled,
  loading,
  children,
  ...otherProps
}: Props) {
  const radixSize = getRadixSize(size);
  let style = otherProps.style ?? {};
  if (variant === "ghost") {
    // hack to make ghost buttons have proper margins / padding
    style = Object.assign(style, {
      margin: 0,
      height: "var(--base-button-height)",
      paddingTop: 0,
      paddingBottom: 0,
      paddingLeft: `var(--space-${parseInt(radixSize as string) + 1})`,
      paddingRight: `var(--space-${parseInt(radixSize as string) + 1})`,
    });
  }

  return (
    <RadixButton
      onClick={onClick}
      color={getRadixColor(theme)}
      variant={variant}
      size={radixSize}
      disabled={disabled}
      loading={loading}
      style={style}
      {...otherProps}
    >
      <Strong>{children}</Strong>
    </RadixButton>
  );
}
