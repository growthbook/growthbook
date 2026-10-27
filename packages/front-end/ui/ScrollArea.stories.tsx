import { Box, Flex, Text } from "@radix-ui/themes";
import ScrollArea from "./ScrollArea";

const rows = Array.from({ length: 20 }, (_, i) => `Row ${i + 1}`);

export default function ScrollAreaStories() {
  return (
    <Flex gap="6">
      {[false, true].map((gutter) => (
        <Flex key={String(gutter)} direction="column" gap="2">
          <Text size="2" weight="bold">
            {gutter ? "With gutter" : "Scrollbar over the content"}
          </Text>
          <Box
            width="200px"
            height="160px"
            style={{ border: "1px solid var(--gray-a5)" }}
          >
            <ScrollArea gutter={gutter} style={{ height: "100%" }}>
              {rows.map((row) => (
                <Text as="div" key={row} style={{ padding: "4px 8px" }}>
                  {row}
                </Text>
              ))}
            </ScrollArea>
          </Box>
        </Flex>
      ))}
    </Flex>
  );
}
