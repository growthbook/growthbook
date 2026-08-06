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
  const { stepLabels, series } = useMemo(() => {
    const steps = isFactFunnelMetric(metric) ? metric.funnelSettings.steps : [];
    return {
      stepLabels: steps.map((s) => s.name),
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
    />
  );
}
