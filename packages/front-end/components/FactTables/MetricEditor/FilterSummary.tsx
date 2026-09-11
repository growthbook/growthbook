import { Box, Flex } from "@radix-ui/themes";
import { FactTableDefinition, RowFilter } from "shared/types/fact-table";
import { operatorLabelMap } from "@/components/FactTables/rowFilterUtils";
import Text from "@/ui/Text";
import Badge from "@/ui/Badge";

export default function FilterSummary({
  rowFilters,
  factTable,
}: {
  rowFilters: RowFilter[];
  factTable: FactTableDefinition | null;
}) {
  return (
    <Flex direction="column" gap="2">
      <Flex align="center" gap="2">
        <Text weight="semibold">Filters</Text>
        <Badge label={String(rowFilters.length)} color="gray" radius="full" />
      </Flex>
      <Box
        p="2"
        style={{
          border: "1px solid var(--gray-a7)",
          borderRadius: "var(--radius-2)",
        }}
      >
        {rowFilters.length ? (
          <Flex gap="2" wrap="wrap">
            {rowFilters.map((rf, i) => (
              <Badge
                key={i}
                color="violet"
                radius="small"
                style={{ whiteSpace: "normal", overflowWrap: "anywhere" }}
                label={`${factTable?.columns.find((c) => c.column === rf.column)?.name || rf.column} ${operatorLabelMap[rf.operator] || rf.operator} ${rf.values?.join(", ") || ""}`.trim()}
              />
            ))}
          </Flex>
        ) : (
          <Text size="sm" color="text-mid">
            No filters
          </Text>
        )}
      </Box>
    </Flex>
  );
}
