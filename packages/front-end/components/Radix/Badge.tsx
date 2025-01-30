import { CSSProperties, forwardRef, ReactElement } from "react";
import { Badge as RadixBadge } from "@radix-ui/themes";
import { MarginProps } from "@radix-ui/themes/dist/esm/props/margin.props.js";
import { RadixColor } from "@/components/Radix/HelperText";

type Props = {
  label: string | ReactElement;
  title?: string;
  color?: RadixColor;
  variant?: "solid" | "soft" | "outline";
  radius?: "none" | "small" | "medium" | "large" | "full";
  style?: CSSProperties;
} & MarginProps;

export default forwardRef<HTMLDivElement, Props>(function Badge(
  { label, title, ...props }: Props,
  ref
) {
  return (
    <RadixBadge ref={ref} title={title} {...props}>
      {label}
    </RadixBadge>
  );
});
