import { CSSProperties, forwardRef, ReactElement } from "react";
import { Badge as RadixBadge } from "@radix-ui/themes";
import { MarginProps } from "@radix-ui/themes/dist/esm/props/margin.props.js";
import { RadixColor } from "@/ui/HelperText";

type Props = {
  label: string | ReactElement;
  title?: string;
  color?: RadixColor;
  variant?: "solid" | "soft" | "outline";
  radius?: "none" | "small" | "medium" | "large" | "full";
  size?: Size;
  style?: CSSProperties;
  className?: string;
} & MarginProps;

export type Size = "xs" | "sm" | "md" | "lg";

// note: "xs" is a synthetic size based on Radix "1" with our own smaller overrides
const sizeMap: Partial<Record<Size, "1" | "2" | "3">> = {
  sm: "1",
  md: "2",
  lg: "3",
};
const xsStyle: CSSProperties = {
  fontSize: "10px",
  lineHeight: "12px",
  paddingInline: "4px",
  paddingBlock: "2px",
  minWidth: "16px",
};

export default forwardRef<HTMLDivElement, Props>(function Badge(
  { label, title, size, style, ...props }: Props,
  ref,
) {
  const resolvedSize = size ? sizeMap[size] : undefined;
  const resolvedStyle = size === "xs" ? { ...xsStyle, ...style } : style;

  return (
    <RadixBadge
      ref={ref}
      title={title}
      size={resolvedSize}
      style={resolvedStyle}
      {...props}
    >
      {label}
    </RadixBadge>
  );
});
