import { Flex, Text } from "@radix-ui/themes";
import CounterBadge from "./CounterBadge";

const USAGE = [
  { color: "neutral", context: "Watchers", caption: "Neutral count" },
  {
    color: "indigo",
    context: "Filters applied",
    caption: "Actively-applied state",
  },
  { color: "amber", context: "Warnings", caption: "Warning" },
  { color: "red", context: "Errors", caption: "Error / needs attention" },
] as const;

export default function CounterBadgeStories() {
  return (
    <Flex direction="column" gap="4">
      <Flex direction="column" gap="2">
        <Text size="2" weight="bold">
          Usage
        </Text>
        <Flex direction="column" gap="2">
          {USAGE.map(({ color, context, caption }) => (
            <Flex key={color} gap="2" align="center">
              <Text size="2">{context}</Text>
              <CounterBadge color={color} count={3} />
              <Text size="1" style={{ color: "var(--gray-9)" }}>
                {color} — {caption}
              </Text>
            </Flex>
          ))}
        </Flex>
      </Flex>

      <Flex direction="column" gap="2">
        <Text size="2" weight="bold">
          Widths (min 16px, grows with content)
        </Text>
        <Flex gap="2" align="center">
          <CounterBadge count={1} />
          <CounterBadge count={12} />
          <CounterBadge count={128} showFullCount />
        </Flex>
      </Flex>
    </Flex>
  );
}
