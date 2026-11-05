import { Box, Flex, Text } from "@radix-ui/themes";
import { ReactNode } from "react";
import ScrollArea, { pinnedTo } from "./ScrollArea";

const rows = Array.from({ length: 20 }, (_, i) => `Row ${i + 1}`);

function Example({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Flex direction="column" gap="2">
      <Text size="2" weight="bold">
        {title}
      </Text>
      <Box
        width="200px"
        height="160px"
        style={{ border: "1px solid var(--gray-a5)" }}
      >
        {children}
      </Box>
    </Flex>
  );
}

export default function ScrollAreaStories() {
  return (
    <Flex gap="6" wrap="wrap">
      {[false, true].map((gutter) => (
        <Example
          key={String(gutter)}
          title={gutter ? "With gutter" : "Scrollbar over the content"}
        >
          <ScrollArea gutter={gutter} alwaysShow style={{ height: "100%" }}>
            {rows.map((row, i) => (
              <Flex
                key={row}
                justify="between"
                px="2"
                py="1"
                style={{ background: i % 2 ? "var(--gray-a2)" : undefined }}
              >
                <Text>{row}</Text>
                <Text>{(i + 1) * 5}%</Text>
              </Flex>
            ))}
          </ScrollArea>
        </Example>
      ))}
      <Example title="Both directions, edges fading">
        <ScrollArea direction="both" edgeCue="fade" style={{ height: "100%" }}>
          {rows.map((row) => (
            <Text
              as="div"
              key={row}
              style={{ padding: "4px 8px", whiteSpace: "nowrap" }}
            >
              {row}, with a label wider than the box
            </Text>
          ))}
        </ScrollArea>
      </Example>
      <Example title="Pinned header, edges shadowed">
        <ScrollArea
          edgeCue="shadow"
          skipEdges={["top"]}
          style={{ height: "100%" }}
        >
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead
              className={pinnedTo.top}
              style={{
                position: "sticky",
                top: 0,
                background: "var(--color-panel-solid)",
              }}
            >
              <tr>
                <th style={{ padding: "4px 8px", textAlign: "left" }}>Name</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row}>
                  <td style={{ padding: "4px 8px" }}>{row}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollArea>
      </Example>
    </Flex>
  );
}
