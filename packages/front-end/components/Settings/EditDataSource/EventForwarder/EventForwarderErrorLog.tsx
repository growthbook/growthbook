import { useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import Link from "@/ui/Link";
import Text from "@/ui/Text";

type LogLine = {
  id: string;
  text: string;
};

export default function EventForwarderErrorLog({
  lines,
}: {
  lines: LogLine[];
}) {
  const [expanded, setExpanded] = useState(false);

  if (lines.length === 0) {
    return null;
  }

  const visibleLines = expanded ? lines.slice(-5) : lines.slice(-2);
  const hasMore = lines.length > 2;

  return (
    <Box>
      <Box
        style={{
          maxHeight: expanded ? 120 : 48,
          overflowY: expanded ? "auto" : "hidden",
          fontFamily: "var(--font-mono, monospace)",
          fontSize: 12,
          lineHeight: 1.5,
        }}
      >
        {visibleLines.map((line) => (
          <Text key={line.id} as="div" color="text-low">
            {line.text}
          </Text>
        ))}
      </Box>
      {hasMore ? (
        <Flex mt="1">
          <Link onClick={() => setExpanded((v) => !v)} style={{ fontSize: 12 }}>
            {expanded ? "Show less" : "Show more"}
          </Link>
        </Flex>
      ) : null}
    </Box>
  );
}
