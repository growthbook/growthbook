import { useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiArrowClockwise } from "react-icons/pi";
import {
  FactTableInterface,
  RowFilter,
  RowFilterTestResults,
} from "shared/types/fact-table";
import { ago, parseWarehouseDate } from "shared/dates";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { TestQueryResultsTable } from "@/components/Settings/DisplayTestQueryResults";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import HelperText from "@/ui/HelperText";
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
// Keyed by organization, since fact table IDs are only unique within one, and
// by SQL, so editing the SQL goes back to the load button.
type LoadedSample = { result: RowFilterTestResults; loadedAt: Date };
const resultCache = new Map<string, LoadedSample>();

// Rows shown inside a table row; the full sample is on the Sample rows tab
const COMPACT_ROWS = 10;

// Sample rows cost a warehouse query, so they only load on a click
export default function FactTableSampleRows({
  factTable,
  rowFilters = [],
  compact = false,
}: {
  factTable: Pick<FactTableInterface, "id" | "sql" | "datasource">;
  rowFilters?: RowFilter[];
  // Smaller rows that grow to the full sample, for use inside a table row
  compact?: boolean;
}) {
  const { apiCall, orgId } = useAuth();
  const { getDatasourceById } = useDefinitions();
  const permissionsUtil = usePermissionsUtil();
  const cacheKey = `${orgId}:${factTable.id}:${factTable.sql}:${JSON.stringify(rowFilters)}`;
  const [loaded, setLoaded] = useState<(LoadedSample & { key: string }) | null>(
    null,
  );
  const sample =
    (loaded?.key === cacheKey ? loaded : resultCache.get(cacheKey)) ?? null;
  const result = sample?.result ?? null;
  const [error, setError] = useState<string | null>(null);
  const datasource = getDatasourceById(factTable.datasource);
  const canRun = !!datasource && permissionsUtil.canRunTestQueries(datasource);

  const load = async () => {
    const res = await apiCall<{ result: RowFilterTestResults }>(
      `/fact-tables/${factTable.id}/test-row-filters`,
      { method: "POST", body: JSON.stringify({ rowFilters }) },
    );
    // Warehouse errors come back as a result; keep them out of the cache and
    // leave the button up to retry
    if (res.result.error) throw new Error(res.result.error);
    const next = { result: res.result, loadedAt: new Date() };
    resultCache.set(cacheKey, next);
    setLoaded({ ...next, key: cacheKey });
  };

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
                onClick={load}
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
      gap="2"
      className={compact ? styles.compact : styles.full}
      // Without inline-size containment, a wide result widens its container
      // and gets clipped instead of scrolling inside it
      style={{ contain: "inline-size" }}
    >
      {canRun ? (
        <Flex align="center" justify="end" gap="3">
          {sample ? (
            <Text size="sm" color="text-mid">
              Loaded {ago(sample.loadedAt)}
            </Text>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            icon={<PiArrowClockwise />}
            setError={setError}
            onClick={load}
          >
            Refresh
          </Button>
        </Flex>
      ) : null}
      {error ? (
        <HelperText status="error" size="sm">
          Couldn&apos;t refresh sample rows: {error}
        </HelperText>
      ) : null}
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
