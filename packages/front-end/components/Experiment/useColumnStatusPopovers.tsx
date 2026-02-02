import { SnapshotMetric } from "shared/types/experiment-snapshot";
import { DifferenceType, StatsEngine } from "shared/types/stats";
import { ExperimentMetricInterface } from "shared/experiments";
import { RowResults } from "@/services/experiments";
import { SSRPolyfills } from "@/hooks/useSSRPolyfills";
import { useResultPopover } from "./useResultPopover";

interface UseColumnStatusPopoversOptions {
  stats: SnapshotMetric;
  baseline: SnapshotMetric;
  rowResults: RowResults;
  metric?: ExperimentMetricInterface;
  differenceType?: DifferenceType;
  statsEngine?: StatsEngine;
  ssrPolyfills?: SSRPolyfills;
  minSampleSize?: number;
  showSuspicious?: boolean;
}

export function useColumnStatusPopovers({
  stats,
  baseline,
  rowResults,
  metric,
  differenceType,
  statsEngine,
  ssrPolyfills,
  minSampleSize = 0,
  showSuspicious = true,
}: UseColumnStatusPopoversOptions) {
  const popoverEnabled = !!(metric && differenceType && statsEngine);

  // Get the max numerator value across baseline and variation
  const currentMetricTotal = Math.max(baseline?.value ?? 0, stats?.value ?? 0);

  // Get time remaining for "not enough data" tooltip
  const enoughDataMeta = rowResults.enoughDataMeta;
  const timeRemainingMs =
    enoughDataMeta?.reason === "notEnoughData" &&
    enoughDataMeta?.showTimeRemaining
      ? (enoughDataMeta.timeRemainingMs ?? undefined)
      : undefined;

  const commonData = {
    stats,
    metric: metric!,
    differenceType: differenceType!,
    statsEngine: statsEngine!,
    ssrPolyfills,
    minSampleSize,
    minPercentChange: rowResults.minPercentChange,
    currentMetricTotal,
    suspiciousThreshold: rowResults.suspiciousThreshold,
  };

  const suspiciousPopover = useResultPopover({
    enabled: popoverEnabled && showSuspicious && rowResults.suspiciousChange,
    data: {
      ...commonData,
      significant: rowResults.significant,
      resultsStatus: rowResults.resultsStatus,
      suspiciousChange: true,
      notEnoughData: false,
    },
  });

  const notEnoughDataPopover = useResultPopover({
    enabled: popoverEnabled && !rowResults.enoughData,
    data: {
      ...commonData,
      significant: false,
      resultsStatus: "",
      suspiciousChange: rowResults.suspiciousChange,
      notEnoughData: true,
      timeRemainingMs,
    },
  });

  const drawPopover = useResultPopover({
    enabled: popoverEnabled && rowResults.resultsStatus === "draw",
    data: {
      ...commonData,
      significant: rowResults.significant,
      resultsStatus: rowResults.resultsStatus,
      suspiciousChange: rowResults.suspiciousChange,
      notEnoughData: false,
    },
  });

  return {
    popoverEnabled,
    suspiciousPopover,
    notEnoughDataPopover,
    drawPopover,
    isDraw: rowResults.resultsStatus === "draw",
  };
}
