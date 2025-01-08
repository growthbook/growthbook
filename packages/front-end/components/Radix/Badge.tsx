import { forwardRef } from "react";
import { Badge as RadixBadge, Text } from "@radix-ui/themes";
import { MarginProps } from "@radix-ui/themes/dist/cjs/props/margin.props";
import { RadixColor } from "@/components/Radix/HelperText";

type Props = {
  label: string;
  title?: string;
  color?: RadixColor;
  variant?: "solid" | "soft";
  radius?: "none" | "small" | "medium" | "large" | "full";
} & MarginProps;

export default forwardRef<HTMLDivElement, Props>(function Badge(
  { label, title, ...props }: Props,
  ref
) {
  return (
    <RadixBadge ref={ref} title={title} {...props}>
      <Text as="span" weight="medium">
        {label}
      </Text>
    </RadixBadge>
  );
});
