import { Box, Flex } from "@radix-ui/themes";
import { FactTableDefinition, RowFilter } from "shared/types/fact-table";
import {
  getRowFilterDescription,
  getRowFilterDisplaySQL,
} from "@/components/FactTables/rowFilterUtils";
import InlineCode from "@/components/SyntaxHighlighting/InlineCode";
import Text from "@/ui/Text";
import Badge from "@/ui/Badge";
import Link from "@/ui/Link";
import { Popover } from "@/ui/Popover";

function RowFilterBadge({
  rowFilter,
  factTable,
}: {
  rowFilter: RowFilter;
  factTable: FactTableDefinition | null;
}) {
  const sql = getRowFilterDisplaySQL(rowFilter, factTable);
  const isSavedFilter = rowFilter.operator === "saved_filter";

  return (
    <Popover
      openOnHover
      side="bottom"
      align="start"
      contentStyle={{ maxWidth: 500 }}
      content={
        <Flex direction="column" gap="2">
          {sql ? (
            <InlineCode language="sql" code={sql} />
          ) : (
            <Text size="sm" color="text-mid">
              No SQL available
            </Text>
          )}
          {isSavedFilter && factTable ? (
            <Link href={`/fact-tables/${factTable.id}#filters`}>
              View saved filters
            </Link>
          ) : null}
        </Flex>
      }
      trigger={
        <Badge
          color="violet"
          radius="small"
          style={{
            whiteSpace: "normal",
            overflowWrap: "anywhere",
            cursor: "default",
          }}
          label={getRowFilterDescription(rowFilter, factTable)}
        />
      }
    />
  );
}

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
        <Text weight="semibold">Row filter</Text>
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
              <RowFilterBadge key={i} rowFilter={rf} factTable={factTable} />
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
