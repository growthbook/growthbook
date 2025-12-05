import { QueryInterface, QueryStatistics } from "back-end/types/query";
import { ReactElement } from "react";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import { GBInfo } from "@/components/Icons";
import { useUser } from "@/services/UserContext";

const numberFormatter = Intl.NumberFormat();

function getNumberOfMetricsInQuery(q: QueryInterface) {
  if (q.queryType === "experimentMetric") return 1;
  if (q.queryType === "experimentMultiMetric") {
    return (
      Object.keys(q.rawResult?.[0] || {}).filter((col) =>
        col.match(/^m(\d+)_id$/),
      ).length || 1
    );
  }
  return 0;
}

export default function QueryStatsRow({
  queries,
  showPipelineMode = false,
}: {
  queries: QueryInterface[];
  showPipelineMode?: boolean;
}) {
  const { hasCommercialFeature } = useUser();
  const hasOptimizedQueries = hasCommercialFeature("multi-metric-queries");

  const queryStats: QueryStatistics[] = queries
    .map((q) => q.statistics)
    .filter((q): q is QueryStatistics => !!q);

  if (!queryStats.length) return null;

  const usingPipelineMode = queries.some((q) => {
    if (q.queryType === "experimentUnits") return true;
    if (q.queryType?.includes("experimentIncrementalRefresh")) return true;
    return false;
  });

  const factTableOptimizedMetrics = !hasOptimizedQueries
    ? 0
    : queries
        .filter((q) => q.queryType === "experimentMultiMetric")
        .map((q) => getNumberOfMetricsInQuery(q))
        .reduce((sum, n) => sum + n, 0);

  const totalMetrics = queries
    .map((q) => getNumberOfMetricsInQuery(q))
    .reduce((sum, n) => sum + n, 0);

  return (
    <div className="row">
      {showPipelineMode && (
        <PremiumTooltip
          body={
            <>
              <h5>Pipeline Mode</h5>
              <div>
                When enabled, GrowthBook will persist intermediate exposure data
                back to your warehouse to reduce the amount scanned by
                subsequent metric queries.
              </div>
            </>
          }
          commercialFeature="pipeline-mode"
        >
          <BooleanQueryStatDisplay
            stat={
              <>
                Pipeline Mode <GBInfo />
              </>
            }
            values={usingPipelineMode ? [true] : [false]}
          />
        </PremiumTooltip>
      )}
      {totalMetrics > 0 && (
        <PremiumTooltip
          body={
            <>
              <h5>Fact Table Query Optimization</h5>
              <div>
                Multiple metrics in the same Fact Table can be optimized and
                combined into a single query, which is much faster and more
                efficient.
              </div>
            </>
          }
          commercialFeature="multi-metric-queries"
        >
          <div className="col-auto mb-2">
            <span className="uppercase-title">
              Fact Optimized <GBInfo />
            </span>
            :{" "}
            <strong>
              {queries.length === 1
                ? factTableOptimizedMetrics > 0
                  ? `${factTableOptimizedMetrics} metrics`
                  : "no"
                : `${factTableOptimizedMetrics}/${totalMetrics} metrics`}
            </strong>
          </div>
        </PremiumTooltip>
      )}
      <NumericQueryStatDisplay
        stat="Execution Duration"
        values={queryStats.map((q) => q.executionDurationMs)}
        format="ms"
      />
      <NumericQueryStatDisplay
        stat="Slot Time"
        values={queryStats.map((q) => q.totalSlotMs)}
        format="ms"
      />
      <NumericQueryStatDisplay
        stat="Bytes Processed"
        values={queryStats.map((q) => q.bytesProcessed)}
        format="bytes"
      />
      <NumericQueryStatDisplay
        stat="Bytes Billed"
        values={queryStats.map((q) => q.bytesBilled)}
        format="bytes"
      />
      <NumericQueryStatDisplay
        stat="Rows Processed"
        values={queryStats.map((q) => q.rowsProcessed)}
        format="number"
      />
      <NumericQueryStatDisplay
        stat="Physical Written Bytes"
        values={queryStats.map((q) => q.physicalWrittenBytes)}
        format="bytes"
      />
      <NumericQueryStatDisplay
        stat="Rows Inserted"
        values={queryStats.map((q) => q.rowsInserted)}
        format="number"
      />
      <BooleanQueryStatDisplay
        stat="Warehouse Cached"
        values={queryStats.map((q) => q.warehouseCachedResult)}
      />
      <BooleanQueryStatDisplay
        stat="Using Partitions"
        values={queryStats.map((q) => q.partitionsUsed)}
      />
    </div>
  );
}

function BooleanQueryStatDisplay({
  stat,
  values,
}: {
  stat: string | ReactElement;
  values: (boolean | undefined)[];
}) {
  const nonNullValues = values.filter((v): v is boolean => v !== undefined);
  if (nonNullValues.length === 0) return null;

  const total = nonNullValues.length;
  const trueCount = nonNullValues.filter((v) => v).length;

  const display =
    nonNullValues.length === 1
      ? nonNullValues[0]
        ? "yes"
        : "no"
      : `${trueCount}/${total}`;

  return (
    <div className="col-auto mb-2">
      <span className="uppercase-title">{stat}</span>:{" "}
      <strong>{display}</strong>
    </div>
  );
}

export function NumericQueryStatDisplay({
  stat,
  format,
  values,
}: {
  stat: string | ReactElement;
  format: "number" | "ms" | "bytes";
  values: (number | undefined)[];
}) {
  const nonNullValues = values.filter((v): v is number => v !== undefined);
  if (nonNullValues.length === 0) return null;

  const sum = nonNullValues.reduce((a, b) => a + b, 0);

  let display = numberFormatter.format(sum);

  if (format === "ms") {
    display = formatTime(sum);
  } else if (format === "bytes") {
    display = shortenBytes(sum);
  }

  return (
    <div className="col-auto mb-2">
      <span className="uppercase-title">{stat}</span>:{" "}
      <strong title={sum + ""}>{display}</strong>
    </div>
  );
}

// From: https://stackoverflow.com/questions/15900485/correct-way-to-convert-size-in-bytes-to-kb-mb-gb-in-javascript
function shortenBytes(n) {
  const k = n > 0 ? Math.floor(Math.log2(n) / 10) : 0;
  const rank = (k > 0 ? "KMGT"[k - 1] : "") + "b";
  const count = (n / Math.pow(1024, k)).toFixed(1);
  return count + rank;
}

function formatTime(timeMs) {
  if (timeMs < 1000) return `${timeMs}ms`;
  if (timeMs < 60 * 1000) return `${(timeMs / 1000).toFixed(1)}s`;

  const s = Math.floor((timeMs / 1000) % 60);
  const m = Math.floor((timeMs / (60 * 1000)) % 60);
  const h = Math.floor(timeMs / (60 * 60 * 1000));

  return `${h > 0 ? h + "h " : ""}${m}m ${s}s`;
}
