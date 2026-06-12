import { Flex } from "@radix-ui/themes";
import Text from "@/ui/Text";
import VariationNumber from "@/ui/VariationNumber";

export interface VariationLabelProps {
  number: number;
  name: string;
  size?: "small" | "medium" | "large";
}

export default function VariationLabel({
  number,
  name,
  size = "medium",
}: VariationLabelProps) {
  return (
    <Flex align="center" gap="1">
      <VariationNumber number={number} />
      <Text size={size} weight="medium" color="text-mid">
        {name}
      </Text>
    </Flex>
  );
}
