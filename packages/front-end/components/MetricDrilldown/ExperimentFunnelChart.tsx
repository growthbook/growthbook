import { useMemo } from "react";
import {
  getFunnelMetricNumbers,
  HARDCODED_FUNNEL_METRIC,
} from "shared/experiments";
import { ExperimentReportVariation } from "shared/types/report";
import FunnelStepsChart from "@/enterprise/components/ProductAnalytics/MainSection/FunnelStepsChart";

export default function ExperimentFunnelChart({
  variations,
  yAxisScale = "percent",
  animate = true,
}: {
  variations: ExperimentReportVariation[];
  yAxisScale?: "count" | "percent";
  animate?: boolean;
}) {
  // The same getFunnelMetricNumbers mock feeds the gbstats pipeline
  // (back-end getFunnelResultsForStatsEngine in services/stats.ts), so the
  // per-step counts shown here stay consistent with the results table.
  const { stepLabels, series } = useMemo(() => {
    const numbers = getFunnelMetricNumbers(HARDCODED_FUNNEL_METRIC, variations);
    return {
      stepLabels: HARDCODED_FUNNEL_METRIC.steps.map((s) => s.name),
      series: variations.map((v) => ({
        key: String(v.index),
        label: v.name,
        counts: numbers.steps.map((step) => step.count[v.index] ?? 0),
        avgTimes: numbers.steps.map(() => null),
      })),
    };
  }, [variations]);

  return (
    <FunnelStepsChart
      stepLabels={stepLabels}
      series={series}
      yAxisScale={yAxisScale}
      animate={animate}
    />
  );
}
