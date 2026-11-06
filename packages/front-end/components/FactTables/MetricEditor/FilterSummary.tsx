import { useRef } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { FactTableDefinition, RowFilter } from "shared/types/fact-table";
import {
  getRowFilterDescription,
  getRowFilterDisplaySQL,
} from "@/components/FactTables/rowFilterUtils";
import InlineCode from "@/components/SyntaxHighlighting/InlineCode";
import useIsOverflowing from "@/hooks/useIsOverflowing";
import Text from "@/ui/Text";
import Badge from "@/ui/Badge";
import Link from "@/ui/Link";
import { Popover } from "@/ui/Popover";

const SQL_PREVIEW_MAX_HEIGHT = 200;

function RowFilterPopoverContent({
  sql,
  factTable,
  savedFilterId,
}: {
  sql: string;
  factTable: FactTableDefinition | null;
  savedFilterId: string | null;
}) {
  const sqlRef = useRef<HTMLDivElement>(null);
  const overflows = useIsOverflowing(sqlRef, SQL_PREVIEW_MAX_HEIGHT);
  const filterHref =
    savedFilterId && factTable
      ? `/fact-tables/${factTable.id}?filter=${encodeURIComponent(savedFilterId)}#filters`
      : null;
  // Long SQL is clipped when the fact table can show the rest; an inline
  // filter has no other home, so it scrolls here instead.
  const clipped = !!filterHref && overflows;

  return (
    <Flex direction="column" gap="2">
      {sql ? (
        <Box
          className={clipped ? "fade-mask-bottom-1rem" : undefined}
          style={{
            maxHeight: SQL_PREVIEW_MAX_HEIGHT,
            overflowY: filterHref ? "hidden" : "auto",
          }}
        >
          <div ref={sqlRef}>
            <InlineCode language="sql" code={sql} />
          </div>
        </Box>
      ) : (
        <Text size="sm" color="text-mid">
          No SQL available
        </Text>
      )}
      {filterHref ? (
        <Link href={filterHref}>
          {clipped ? "View full filter" : "View saved filter"}
        </Link>
      ) : null}
    </Flex>
  );
}

function RowFilterBadge({
  rowFilter,
  factTable,
}: {
  rowFilter: RowFilter;
  factTable: FactTableDefinition | null;
}) {
  const sql = getRowFilterDisplaySQL(rowFilter, factTable);
  const savedFilterId =
    rowFilter.operator === "saved_filter"
      ? (rowFilter.values?.[0] ?? null)
      : null;

  return (
    <Popover
      openOnHover
      side="bottom"
      align="start"
      contentStyle={{ maxWidth: 500 }}
      content={
        <RowFilterPopoverContent
          sql={sql}
          factTable={factTable}
          savedFilterId={savedFilterId}
        />
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
