import { useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { RowFilter, RowFilterTestResults } from "shared/types/fact-table";
import { parseWarehouseDate } from "shared/dates";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { TestQueryResultsTable } from "@/components/Settings/DisplayTestQueryResults";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
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

// Fixed widths so the placeholder doesn't reshuffle on every render
const SKELETON_WIDTHS = [
  [45, 55, 40, 50],
  [65, 75, 50, 60],
  [55, 60, 45, 40],
  [70, 50, 55, 45],
  [60, 65, 40, 55],
];

// Kept for the page session so switching tabs or rows doesn't re-run the query.
// Keyed by organization, since fact table IDs are only unique within one.
// shortcut: never invalidated until a full page reload; add a refresh button if stale rows become a problem
const resultCache = new Map<string, RowFilterTestResults>();

// Rows shown inside a table row; the full sample is on the Sample rows tab
const COMPACT_ROWS = 10;

// Sample rows cost a warehouse query, so they only load on a click
export default function FactTableSampleRows({
  factTableId,
  rowFilters = [],
  compact = false,
}: {
  factTableId: string;
  rowFilters?: RowFilter[];
  // Smaller rows that grow to the full sample, for use inside a table row
  compact?: boolean;
}) {
  const { apiCall, orgId } = useAuth();
  const { getFactTableById, getDatasourceById } = useDefinitions();
  const permissionsUtil = usePermissionsUtil();
  const cacheKey = `${orgId}:${factTableId}:${JSON.stringify(rowFilters)}`;
  const [result, setResult] = useState<RowFilterTestResults | null>(
    resultCache.get(cacheKey) ?? null,
  );
  const [error, setError] = useState<string | null>(null);
  const datasourceId = getFactTableById(factTableId)?.datasource;
  const datasource = datasourceId ? getDatasourceById(datasourceId) : null;
  const canRun = !!datasource && permissionsUtil.canRunTestQueries(datasource);

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
          {error ? <Callout status="error">{error}</Callout> : null}
          {canRun ? (
            <>
              <Button
                variant="outline"
                size="sm"
                setError={setError}
                onClick={async () => {
                  const res = await apiCall<{ result: RowFilterTestResults }>(
                    `/fact-tables/${factTableId}/test-row-filters`,
                    { method: "POST", body: JSON.stringify({ rowFilters }) },
                  );
                  // Warehouse errors come back as a result; keep them out of
                  // the cache and leave the button up to retry
                  if (res.result.error) throw new Error(res.result.error);
                  resultCache.set(cacheKey, res.result);
                  setResult(res.result);
                }}
              >
                {error ? "Try again" : "Load sample rows"}
              </Button>
              <Text size="sm" color="text-mid">
                Runs a small query
                {datasource ? ` on ${datasource.name}` : ""}
              </Text>
            </>
          ) : (
            <Text size="sm" color="text-mid">
              You don&apos;t have permission to run queries on this Data Source.
            </Text>
          )}
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
            { contain: "inline-size" }
          : undefined
      }
    >
      <TestQueryResultsTable
        duration={result.duration || 0}
        results={
          compact
            ? (result.results || []).slice(0, COMPACT_ROWS)
            : result.results || []
        }
        sql={result.sql || ""}
        error=""
        expandable={false}
        allowDownload={true}
        compact={compact}
        renderCell={renderSampleCell}
      />
    </Flex>
  );
}
