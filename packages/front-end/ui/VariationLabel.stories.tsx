import { Box, Flex, Text } from "@radix-ui/themes";
import VariationLabel from "./VariationLabel";

export default function VariationLabelStories() {
  return (
    <Flex direction="column" gap="4">
      <Flex direction="column" gap="2">
        <Text size="2" weight="bold">
          Sizes
        </Text>
        <Flex direction="column" gap="2">
          {(["small", "medium", "large"] as const).map((size) => (
            <Flex key={size} gap="2" align="center">
              <Text size="1" style={{ width: 64, color: "var(--gray-9)" }}>
                {size}
              </Text>
              <VariationLabel number={1} name="Variation 1" size={size} />
            </Flex>
          ))}
        </Flex>
      </Flex>

      <Flex direction="column" gap="2">
        <Text size="2" weight="bold">
          Variations
        </Text>
        <Flex direction="column" gap="2">
          <VariationLabel number={0} name="Control" />
          <VariationLabel number={1} name="Variation 1" />
          <VariationLabel number={2} name="Variation 2" />
          <VariationLabel number={3} name="Variation 3" />
        </Flex>
      </Flex>

      <Flex direction="column" gap="2">
        <Text size="2" weight="bold">
          Truncation
        </Text>
        <Flex direction="column" gap="2">
          {(["small", "medium", "large"] as const).map((size) => (
            <Flex key={size} gap="2" align="center">
              <Text size="1" style={{ width: 64, color: "var(--gray-9)" }}>
                {size}
              </Text>
              <Box
                width="120px"
                p="2"
                style={{ border: "1px solid var(--gray-6)" }}
              >
                <VariationLabel
                  number={1}
                  name="A very long variation name that should truncate"
                  size={size}
                />
              </Box>
            </Flex>
          ))}
        </Flex>
      </Flex>

      <Flex direction="column" gap="2">
        <Text size="2" weight="bold">
          Number-only (very limited space)
        </Text>
        <Flex direction="column" gap="2">
          {([60, 40] as const).map((width) => (
            <Flex key={width} gap="2" align="center">
              <Text size="1" style={{ width: 64, color: "var(--gray-9)" }}>
                {width}px
              </Text>
              <Box
                width={`${width}px`}
                p="2"
                style={{ border: "1px solid var(--gray-6)" }}
              >
                <VariationLabel
                  number={1}
                  name="A very long variation name that should truncate"
                />
              </Box>
            </Flex>
          ))}
        </Flex>
      </Flex>

      <Flex direction="column" gap="2">
        <Text size="2" weight="bold">
          Resizable (drag the right edge)
        </Text>
        <Box
          p="2"
          style={{
            width: 280,
            minWidth: 28,
            maxWidth: "100%",
            resize: "horizontal",
            overflow: "auto",
            border: "1px solid var(--gray-6)",
          }}
        >
          <VariationLabel
            number={2}
            name="A very long variation name that should truncate"
          />
        </Box>
      </Flex>
    </Flex>
  );
}
