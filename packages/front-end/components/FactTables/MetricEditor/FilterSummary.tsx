import { Flex } from "@radix-ui/themes";
import { FactTableDefinition, RowFilter } from "shared/types/fact-table";
import { operatorLabelMap } from "@/components/FactTables/rowFilterUtils";
import Text from "@/ui/Text";

export default function FilterSummary({
  rowFilters,
  factTable,
}: {
  rowFilters: RowFilter[];
  factTable: FactTableDefinition | null;
}) {
  if (!rowFilters.length) {
    return (
      <Text color="text-mid" as="div">
        No filters
      </Text>
    );
  }

  return (
    <Flex direction="column" gap="1">
      <Text as="div">
        {rowFilters.length} filter{rowFilters.length === 1 ? "" : "s"} applied
      </Text>
      <Flex direction="column" gap="1" pl="3">
        {rowFilters.map((rf, i) => (
          <Text key={i} size="sm" color="text-mid" as="div">
            {factTable?.columns.find((c) => c.column === rf.column)?.name ||
              rf.column}{" "}
            {operatorLabelMap[rf.operator] || rf.operator}{" "}
            {rf.values?.join(", ")}
          </Text>
        ))}
      </Flex>
    </Flex>
  );
}
