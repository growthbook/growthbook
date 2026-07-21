import { Flex, Text } from "@radix-ui/themes";
import CounterBadge from "./CounterBadge";

export default function CounterBadgeStories() {
  return (
    <Flex direction="column" gap="4">
      <Flex direction="column" gap="2">
        <Text size="2" weight="bold">
          Colors
        </Text>
        <Flex gap="2" align="center">
          <CounterBadge color="slate" count={3} />
          <CounterBadge color="amber" count={3} />
          <CounterBadge color="red" count={3} />
        </Flex>
      </Flex>

      <Flex direction="column" gap="2">
        <Text size="2" weight="bold">
          Widths (min 16px, grows with content)
        </Text>
        <Flex gap="2" align="center">
          <CounterBadge count={1} />
          <CounterBadge count={12} />
          <CounterBadge count={128} />
        </Flex>
      </Flex>
    </Flex>
  );
}
