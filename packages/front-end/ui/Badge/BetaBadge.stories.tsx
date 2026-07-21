import { Flex, Text } from "@radix-ui/themes";
import BetaBadge from "./BetaBadge";

export default function BetaBadgeStories() {
  return (
    <Flex direction="column" gap="4">
      <Flex direction="column" gap="2">
        <Text size="2" weight="bold">
          Default (xs)
        </Text>
        <Flex gap="2" align="center">
          <Text size="2">Feature Flags</Text>
          <BetaBadge />
        </Flex>
      </Flex>

      <Flex direction="column" gap="2">
        <Text size="2" weight="bold">
          Sizes
        </Text>
        <Flex gap="2" align="center">
          <BetaBadge size="xs" />
          <BetaBadge size="sm" />
        </Flex>
      </Flex>
    </Flex>
  );
}
