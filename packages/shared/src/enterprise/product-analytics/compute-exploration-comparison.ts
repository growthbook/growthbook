import type {
  ExplorationConfig,
  ExplorationDateRange,
  ProductAnalyticsExploration,
  ProductAnalyticsRunComparisonPayload,
} from "shared/validators";
import type { FactMetricInterface } from "shared/types/fact-table";
import { buildAlignedComparisonRowLookup } from "./comparison-alignment";
import { calculateProductAnalyticsDateRange } from "./sql";
import { densifyComparisonExplorationTimeseries } from "./densify-comparison-timeseries";
import {
  buildExplorationColumns,
  getExplorationCellValue,
  getEffectiveShowAs,
  getIsRatioByIndex,
  getEffectiveMetricValue,
  sortExplorationRows,
} from "./utils";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function dateRangeToPeriodStrings(dateRange: ExplorationDateRange): {
  startDate: string;
  endDate: string;
} {
  const dr = calculateProductAnalyticsDateRange(dateRange);
  return {
    startDate: dr.startDate.toISOString().slice(0, 10),
    endDate: dr.endDate.toISOString().slice(0, 10),
  };
}

/**
 * Builds the `comparison` payload for POST /product-analytics/run when two
 * explorations (current + previous window) have been executed.
 */
export function computeExplorationComparisonPayload(
  primary: ProductAnalyticsExploration | null,
  comparison: ProductAnalyticsExploration | null,
  submittedConfig: ExplorationConfig,
  previousTimeFrame: ExplorationDateRange,
  getFactMetricById: (id: string) => FactMetricInterface | null,
): ProductAnalyticsRunComparisonPayload {
  const previousPeriod = dateRangeToPeriodStrings(previousTimeFrame);

  const n = submittedConfig.dataset?.values?.length ?? 0;
  const emptyTrends = Array.from({ length: n }, () => null);

  if (!primary?.result?.rows?.length || n === 0) {
    return {
      exploration: comparison,
      previousPeriod,
      bigNumberTrends: emptyTrends,
      tableTrendsByRow: [],
    };
  }

  const renderOpts = {
    showAs: getEffectiveShowAs(submittedConfig, getFactMetricById),
    isRatioByIndex: getIsRatioByIndex(submittedConfig, getFactMetricById),
  };

  const columns = buildExplorationColumns(submittedConfig, getFactMetricById);
  const hasAnyRatio = columns.some(
    (c) => c.kind === "metric" && c.sub !== "single",
  );

  const densifiedComparison =
    !hasAnyRatio && comparison
      ? densifyComparisonExplorationTimeseries({
          comparison,
          submittedConfig,
          previousTimeFrame,
          getFactMetricById,
        })
      : null;

  const exploration = densifiedComparison ?? comparison;

  if (!exploration?.result?.rows?.length) {
    return {
      exploration,
      previousPeriod,
      bigNumberTrends: emptyTrends,
      tableTrendsByRow: [],
    };
  }

  const bigNumberTrends = Array.from({ length: n }, (_, metricIndex) => {
    const currCell = primary.result.rows[0]?.values[metricIndex];
    const prevCell = exploration.result.rows[0]?.values[metricIndex];
    if (!currCell || !prevCell) return null;

    const isRatio = renderOpts.isRatioByIndex[metricIndex] ?? false;
    const currentValue = getEffectiveMetricValue(currCell, {
      showAs: renderOpts.showAs,
      isRatio,
    });
    const previousValue = getEffectiveMetricValue(prevCell, {
      showAs: renderOpts.showAs,
      isRatio,
    });

    if (previousValue === 0) {
      return {
        currentValue,
        previousValue,
        pctChangeFraction: 0,
        pctChangePercent: 0,
      };
    }

    const pctChangeFraction =
      (currentValue - previousValue) / Math.abs(previousValue);
    return {
      currentValue,
      previousValue,
      pctChangeFraction,
      pctChangePercent: round2(pctChangeFraction * 100),
    };
  });

  if (hasAnyRatio) {
    return {
      exploration,
      previousPeriod,
      bigNumberTrends,
      tableTrendsByRow: [],
    };
  }

  const isTimeseries =
    submittedConfig.dimensions?.[0]?.dimensionType === "date";
  const sortedRows = sortExplorationRows(
    primary.result.rows,
    isTimeseries,
    renderOpts,
  );
  const cmpSorted = sortExplorationRows(
    exploration.result.rows,
    isTimeseries,
    renderOpts,
  );

  const getAlignedCmpRow = buildAlignedComparisonRowLookup(
    sortedRows,
    cmpSorted,
    isTimeseries,
  );

  const tableTrendsByRow = sortedRows.map((row, idx) => {
    const cmpRow = isTimeseries
      ? getAlignedCmpRow(String(row.dimensions[0] ?? ""))
      : (cmpSorted[idx] ?? null);
    const trendRecord: Record<string, number | null> = {};
    for (const col of columns) {
      if (col.kind !== "metric" || col.sub !== "single") continue;
      const rawCurr = getExplorationCellValue(row, col, renderOpts);
      const rawPrev = cmpRow
        ? getExplorationCellValue(cmpRow, col, renderOpts)
        : null;
      const trendKey = `${col.key}__trend`;
      let trend: number | null = null;
      if (
        typeof rawPrev === "number" &&
        typeof rawCurr === "number" &&
        rawPrev !== 0
      ) {
        trend = round2(((rawCurr - rawPrev) / rawPrev) * 100);
      }
      trendRecord[trendKey] = trend;
    }
    return trendRecord;
  });

  return {
    exploration,
    previousPeriod,
    bigNumberTrends,
    tableTrendsByRow,
  };
}
