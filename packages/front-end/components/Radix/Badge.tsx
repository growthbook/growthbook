import { Badge as RadixBadge, Text } from "@radix-ui/themes";
import { MarginProps } from "@radix-ui/themes/dist/cjs/props/margin.props";
import { RadixColor } from "@/components/Radix/HelperText";

type Props = {
  label: string;
  title?: string;
  color?: RadixColor;
  variant?: "solid" | "soft";
} & MarginProps;

export default function Badge({ label, title, ...props }: Props) {
  return (
    <RadixBadge title={title} {...props}>
      <Text as="span" weight="medium">
        {label}
      </Text>
    </RadixBadge>
  );
}
