import { Flex, Badge as RadixBadge } from "@radix-ui/themes";
import { MarginProps } from "@radix-ui/themes/dist/cjs/props/margin.props";
import { RadixColor } from "@/components/Radix/HelperText";

type Props = {
  children: string | JSX.Element;
  color?: RadixColor;
  variant?: "solid" | "soft" | "surface" | "outline";
  highContrast?: boolean;
  radius?: "none" | "small" | "medium" | "large" | "full";
} & MarginProps;

export default function Badge({
  children,
  color,
  variant,
  highContrast,
  radius,
  ...containerProps
}: Props) {
  return (
    <Flex {...containerProps}>
      <RadixBadge
        color={color}
        variant={variant}
        highContrast={highContrast}
        radius={radius}
      >
        {children}
      </RadixBadge>
    </Flex>
  );
}
