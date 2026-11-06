import { useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { RowFilter, RowFilterTestResults } from "shared/types/fact-table";
import { parseWarehouseDate } from "shared/dates";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import { TestQueryResultsTable } from "@/components/Settings/DisplayTestQueryResults";
import Button from "@/ui/Button";
import Text from "@/ui/Text";
import styles from "./FactTableSampleRows.module.scss";

// e.g. "Oct 1, 07:00"; the year and seconds are in the tooltip
const shortTimestamp = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/;

// Fixed-width, truncated cells so every column reads at a glance; the
// full value is in the tooltip
function renderSampleCell(key: string, value: unknown) {
  if ((value ?? null) === null) {
    return <span className={`${styles.cell} ${styles.null}`}>NULL</span>;
  }
  const text =
    typeof value === "number"
      ? value.toLocaleString()
      : typeof value === "string" || typeof value === "boolean"
        ? String(value)
        : JSON.stringify(value);
  // Timestamps read as the viewer's local time; the tooltip keeps the raw value
  const when =
    typeof value === "string" && TIMESTAMP_RE.test(value)
      ? parseWarehouseDate(value)
      : null;
  return (
    <span className={styles.cell} title={text}>
      {when && !isNaN(when.getTime()) ? shortTimestamp.format(when) : text}
    </span>
  );
}

// About the placeholder's height, so loading rows doesn't shift the page
const COMPACT_MAX_HEIGHT = 280;

// Fixed widths so the placeholder doesn't reshuffle on every render
const SKELETON_WIDTHS = [
  [45, 55, 40, 50],
  [65, 75, 50, 60],
  [55, 60, 45, 40],
  [70, 50, 55, 45],
  [60, 65, 40, 55],
];

// Kept for the page session so switching tabs or rows doesn't re-run the query.
// shortcut: never invalidated until a full page reload; add a refresh button if stale rows become a problem
const resultCache = new Map<string, RowFilterTestResults>();

// Sample rows cost a warehouse query, so they only load on a click
export default function FactTableSampleRows({
  factTableId,
  rowFilters = [],
  compact = false,
}: {
  factTableId: string;
  rowFilters?: RowFilter[];
  // Smaller rows in a fixed-height box that scrolls, for use inside a table row
  compact?: boolean;
}) {
  const { apiCall } = useAuth();
  const { getFactTableById, getDatasourceById } = useDefinitions();
  const cacheKey = `${factTableId}:${JSON.stringify(rowFilters)}`;
  const [result, setResult] = useState<RowFilterTestResults | null>(
    resultCache.get(cacheKey) ?? null,
  );
  const datasourceId = getFactTableById(factTableId)?.datasource;
  const datasourceName = datasourceId
    ? getDatasourceById(datasourceId)?.name
    : undefined;

  if (!result) {
    return (
      <Box className={styles.placeholder}>
        {SKELETON_WIDTHS.map((row, i) => (
          <Box key={i} className={styles.skeletonRow} aria-hidden>
            {row.map((width, j) => (
              <Box
                key={j}
                className={styles.bar}
                style={{ width: `${width}%` }}
              />
            ))}
          </Box>
        ))}
        <Flex className={styles.overlay}>
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              const res = await apiCall<{ result: RowFilterTestResults }>(
                `/fact-tables/${factTableId}/test-row-filters`,
                { method: "POST", body: JSON.stringify({ rowFilters }) },
              );
              resultCache.set(cacheKey, res.result);
              setResult(res.result);
            }}
          >
            Load sample rows
          </Button>
          <Text size="sm" color="text-mid">
            Runs a small query
            {datasourceName ? ` on ${datasourceName}` : ""}
          </Text>
        </Flex>
      </Box>
    );
  }

  return (
    <Flex
      direction="column"
      className={compact ? styles.compact : styles.full}
      style={
        compact
          ? // Without inline-size containment, a wide result widens the
            // enclosing table cell instead of scrolling inside it
            { maxHeight: COMPACT_MAX_HEIGHT, contain: "inline-size" }
          : undefined
      }
    >
      <TestQueryResultsTable
        duration={result.duration || 0}
        results={result.results || []}
        sql={result.sql || ""}
        error={result.error || ""}
        expandable={false}
        allowDownload={true}
        compact={compact}
        renderCell={renderSampleCell}
      />
    </Flex>
  );
}
