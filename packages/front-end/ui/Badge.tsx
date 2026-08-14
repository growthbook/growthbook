import { CSSProperties, forwardRef, ReactElement } from "react";
import { Badge as RadixBadge } from "@radix-ui/themes";
import { MarginProps } from "@radix-ui/themes/dist/esm/props/margin.props.js";
import { RadixColor } from "@/ui/HelperText";
import { radixSize, Size as SharedSize } from "@/ui/sizes";
import { useTx } from "@/services/i18n";

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

export type Size = SharedSize<"xs" | "sm" | "md" | "lg">;

// xs has no Radix step of its own. It is Radix "1" plus the overrides below,
// which is why it cannot go through the shared radixSize map.
const xsStyle: CSSProperties = {
  fontSize: "10px",
  lineHeight: "12px",
  paddingInline: "4px",
  paddingBlock: "2px",
  minWidth: "16px",
};

export default forwardRef<HTMLDivElement, Props>(function Badge(
  { label, title, size = "sm", style, ...props }: Props,
  ref,
) {
  const tx = useTx();
  const resolvedSize = size === "xs" ? "1" : radixSize(size);
  // Center the badge against adjacent text when rendered inline (e.g. next to a
  // tab label). No-op for flex/grid children, which ignore vertical-align.
  const resolvedStyle: CSSProperties =
    size === "xs"
      ? { verticalAlign: "middle", ...xsStyle, ...style }
      : { verticalAlign: "middle", ...style };

  return (
    <RadixBadge
      ref={ref}
      title={typeof title === "string" ? (tx(title) as string) : title}
      size={resolvedSize}
      style={resolvedStyle}
      {...props}
    >
      {tx(label)}
    </RadixBadge>
  );
});
