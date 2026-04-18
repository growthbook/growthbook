import { Flex, Text } from "@radix-ui/themes";
import Badge from "./Badge";

export default function BadgeStories() {
  return (
    <Flex direction="column" gap="4">
      <Flex direction="column" gap="2">
        <Text size="2" weight="bold">
          Colors
        </Text>
        <Flex gap="2" align="center">
          <Badge label="Default" />
          <Badge color="indigo" label="Indigo" />
          <Badge color="cyan" label="Cyan" />
          <Badge color="orange" label="Orange" />
          <Badge color="crimson" label="Crimson" />
        </Flex>
      </Flex>

      <Flex direction="column" gap="2">
        <Text size="2" weight="bold">
          Variants, Sizes
        </Text>
        <Flex direction="column" gap="2">
          {(["soft", "solid", "outline"] as const).map((variant) => (
            <Flex key={variant} gap="2" align="center">
              <Text size="1" style={{ width: 48, color: "var(--gray-9)" }}>
                {variant}
              </Text>
              <Badge variant={variant} size="xs" label="xs" />
              <Badge variant={variant} size="sm" label="sm" />
              <Badge variant={variant} size="md" label="md" />
              <Badge variant={variant} size="lg" label="lg" />
            </Flex>
          ))}
        </Flex>
      </Flex>
    </Flex>
  );
}
