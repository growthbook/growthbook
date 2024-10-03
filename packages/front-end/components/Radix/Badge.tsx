import { Badge as RadixBadge } from "@radix-ui/themes";
import { MarginProps } from "@radix-ui/themes/dist/cjs/props/margin.props";
import { RadixColor } from "@/components/Radix/HelperText";

type Props = {
  children: string | JSX.Element;
  color?: RadixColor;
  variant?: "solid" | "soft";
} & MarginProps;

export default function Badge({ children, ...props }: Props) {
  return <RadixBadge {...props}>{children}</RadixBadge>;
}
