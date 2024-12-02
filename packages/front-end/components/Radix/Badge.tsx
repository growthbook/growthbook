import { Badge as RadixBadge, Text } from "@radix-ui/themes";
import { MarginProps } from "@radix-ui/themes/dist/cjs/props/margin.props";
import { RadixColor } from "@/components/Radix/HelperText";

type Props = {
  label: string;
  icon?: React.ReactNode;
  title?: string;
  color?: RadixColor;
  variant?: "solid" | "soft";
  radius?: "none" | "small" | "medium" | "large" | "full";
} & MarginProps;

export default function Badge({ label, title, color, icon, ...props }: Props) {
  return (
    <RadixBadge title={title} color={color} {...props}>
      {icon ? icon : null}
      <Text as="span" weight="medium">
        {label}
      </Text>
    </RadixBadge>
  );
}
