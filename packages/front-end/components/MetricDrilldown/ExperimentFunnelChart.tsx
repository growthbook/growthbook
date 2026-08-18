import { useMemo } from "react";
import {
  ExperimentMetricDefinition,
  funnelStepMetricId,
  isFactFunnelMetric,
} from "shared/experiments";
import {
  ExperimentReportResultDimension,
  ExperimentReportVariation,
} from "shared/types/report";
import FunnelStepsChart from "@/enterprise/components/ProductAnalytics/MainSection/FunnelStepsChart";
import { getVariationColor } from "@/services/features";

export default function ExperimentFunnelChart({
  metric,
  results,
  variations,
  yAxisScale = "percent",
  animate = true,
}: {
  metric: ExperimentMetricDefinition;
  results?: ExperimentReportResultDimension;
  variations: ExperimentReportVariation[];
  yAxisScale?: "count" | "percent";
  animate?: boolean;
}) {
  const { stepLabels, series, colors } = useMemo(() => {
    const steps = isFactFunnelMetric(metric) ? metric.funnelSettings.steps : [];
    return {
      stepLabels: steps.map((s) => s.name),
      // Match the bars to each variation's identity color so the funnel reads
      // consistently with VariationNumber/VariationLabel elsewhere.
      colors: variations.map((v) => getVariationColor(v.index, true)),
      series: variations.map((v) => ({
        key: String(v.index),
        label: v.name,
        // Each step's per-variation count is the "reached step k" binomial the
        // stats pipeline emits under funnelStepMetricId; missing cells read 0.
        counts: steps.map(
          (_step, stepIndex) =>
            results?.variations?.[v.index]?.metrics?.[
              funnelStepMetricId(metric.id, stepIndex)
            ]?.value ?? 0,
        ),
        avgTimes: steps.map(() => null),
      })),
    };
  }, [metric, results, variations]);

  return (
    <FunnelStepsChart
      stepLabels={stepLabels}
      series={series}
      yAxisScale={yAxisScale}
      animate={animate}
      colors={colors}
    />
  );
}
