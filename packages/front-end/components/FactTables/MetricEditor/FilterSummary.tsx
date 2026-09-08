import { useState } from "react";
import { Flex } from "@radix-ui/themes";
import { FactTableDefinition, RowFilter } from "shared/types/fact-table";
import { operatorLabelMap } from "@/components/FactTables/rowFilterUtils";
import Text from "@/ui/Text";
import Link from "@/ui/Link";

// Plain-English "N filters applied" disclosure - replaces RowFilterCodeDisplay's
// SQL WHERE block, which isn't what the newer Figma view wants for read-only
// filters. Local open/close state matches AdvancedSettings' own Show/Hide link.
export default function FilterSummary({
  rowFilters,
  factTable,
}: {
  rowFilters: RowFilter[];
  factTable: FactTableDefinition | null;
}) {
  const [open, setOpen] = useState(false);

  if (!rowFilters.length) {
    return (
      <Text color="text-mid" as="div">
        No filters
      </Text>
    );
  }

  return (
    <Flex direction="column" gap="1">
      <Link onClick={() => setOpen(!open)}>
        {rowFilters.length} filter{rowFilters.length === 1 ? "" : "s"} applied
      </Link>
      {open && (
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
      )}
    </Flex>
  );
}
