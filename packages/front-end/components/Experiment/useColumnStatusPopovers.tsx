import { SnapshotMetric } from "shared/types/experiment-snapshot";
import { DifferenceType, StatsEngine } from "shared/types/stats";
import { ExperimentMetricInterface } from "shared/experiments";
import { RowResults } from "@/services/experiments";
import { SSRPolyfills } from "@/hooks/useSSRPolyfills";
import { useResultPopover } from "./useResultPopover";

interface UseColumnStatusPopoversOptions {
  stats: SnapshotMetric;
  rowResults: RowResults;
  metric?: ExperimentMetricInterface;
  differenceType?: DifferenceType;
  statsEngine?: StatsEngine;
  ssrPolyfills?: SSRPolyfills;
  minSampleSize?: number;
  showSuspicious?: boolean;
}

export type StatusType = "notEnoughData" | "draw" | "suspicious" | null;

export function useColumnStatusPopovers({
  stats,
  rowResults,
  metric,
  differenceType,
  statsEngine,
  ssrPolyfills,
  minSampleSize = 0,
  showSuspicious = true,
}: UseColumnStatusPopoversOptions) {
  const popoverEnabled = !!(metric && differenceType && statsEngine);

  // Determine which status applies (in priority order)
  // notEnoughData takes priority, then draw, then suspicious
  const statusType: StatusType = !rowResults.enoughData
    ? "notEnoughData"
    : rowResults.resultsStatus === "draw"
      ? "draw"
      : showSuspicious && rowResults.suspiciousChange
        ? "suspicious"
        : null;

  // Get time remaining for "not enough data" tooltip
  const enoughDataMeta = rowResults.enoughDataMeta;
  const timeRemainingMs =
    enoughDataMeta?.reason === "notEnoughData" &&
    enoughDataMeta?.showTimeRemaining
      ? (enoughDataMeta.timeRemainingMs ?? undefined)
      : undefined;

  // Single popover with dynamic data - ExperimentResultTooltipContent
  // handles notEnoughData first, so we can pass raw values
  const popover = useResultPopover({
    enabled: popoverEnabled && statusType !== null,
    data: {
      stats,
      metric: metric!,
      differenceType: differenceType!,
      statsEngine: statsEngine!,
      ssrPolyfills,
      minSampleSize,
      minPercentChange: rowResults.minPercentChange,
      currentMetricTotal: rowResults.currentMetricTotal,
      suspiciousThreshold: rowResults.suspiciousThreshold,
      significant: rowResults.significant,
      resultsStatus: rowResults.resultsStatus,
      suspiciousChange: rowResults.suspiciousChange,
      notEnoughData: !rowResults.enoughData,
      timeRemainingMs,
    },
  });

  return {
    statusType,
    Trigger: popover.Trigger,
  };
}
