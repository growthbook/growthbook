import { Flex, Text } from "@radix-ui/themes";
import VariationNumber from "./VariationNumber";

const VARIATION_COUNT = 9;

export default function VariationNumberStories() {
  return (
    <Flex direction="column" gap="4">
      <Flex direction="column" gap="2">
        <Text size="2" weight="bold">
          All Colors (0–8)
        </Text>
        <Flex gap="2" align="center" wrap="wrap">
          {Array.from({ length: VARIATION_COUNT }, (_, i) => (
            <Flex key={i} align="center" gap="1">
              <VariationNumber number={i} />
            </Flex>
          ))}
        </Flex>
      </Flex>

      <Flex direction="column" gap="2">
        <Text size="2" weight="bold">
          Color Cycling (9–17)
        </Text>
        <Text size="1" style={{ color: "var(--gray-9)" }}>
          Colors repeat every 9 variations.
        </Text>
        <Flex gap="2" align="center" wrap="wrap">
          {Array.from({ length: VARIATION_COUNT }, (_, i) => (
            <Flex key={i} align="center" gap="1">
              <VariationNumber number={i + VARIATION_COUNT} />
            </Flex>
          ))}
        </Flex>
      </Flex>
    </Flex>
  );
}
