import { Flex, Text } from "@radix-ui/themes";
import ExpandableBlock from "./ExpandableBlock";

const longText = Array.from(
  { length: 12 },
  (_, i) => `Line ${i + 1} of a block that is taller than the clamp.`,
).join(" ");

export default function ExpandableBlockStories() {
  return (
    <Flex direction="column" gap="5" style={{ maxWidth: 360 }}>
      <Flex direction="column" gap="2">
        <Text size="2" weight="bold">
          Short, no toggle
        </Text>
        <ExpandableBlock>
          <Text size="2">Fits without clamping.</Text>
        </ExpandableBlock>
      </Flex>
      <Flex direction="column" gap="2">
        <Text size="2" weight="bold">
          Clamped. Show more sets aria-expanded and aria-controls.
        </Text>
        <ExpandableBlock maxHeight={80}>
          <Text size="2">{longText}</Text>
        </ExpandableBlock>
      </Flex>
      <Flex direction="column" gap="2">
        <Text size="2" weight="bold">
          Starts expanded
        </Text>
        <ExpandableBlock maxHeight={80} defaultExpanded>
          <Text size="2">{longText}</Text>
        </ExpandableBlock>
      </Flex>
    </Flex>
  );
}
