import { TimeSeriesBlockInterface } from "back-end/src/enterprise/validators/dashboard-block";
import ExperimentMetricTimeSeriesGraphWrapper from "@/components/Experiment/ExperimentMetricTimeSeriesGraphWrapper";
import useOrgSettings from "@/hooks/useOrgSettings";
import { BlockProps } from ".";

export default function TimeSeriesBlock({
  block: { variationIds },
  experiment,
  snapshot,
  analysis,
  ssrPolyfills,
  metric,
}: BlockProps<TimeSeriesBlockInterface>) {
  const { pValueCorrection, statsEngine: hookStatsEngine } = useOrgSettings();

  const statsEngine =
    ssrPolyfills?.useOrgSettings()?.statsEngine ||
    hookStatsEngine ||
    "frequentist";

  // Determine which group the metric belongs to
  let resultGroup: "goal" | "secondary" | "guardrail" = "goal";
  if (experiment.secondaryMetrics.includes(metric.id)) {
    resultGroup = "secondary";
  } else if (experiment.guardrailMetrics.includes(metric.id)) {
    resultGroup = "guardrail";
  }

  const appliedPValueCorrection =
    resultGroup === "goal"
      ? (ssrPolyfills?.useOrgSettings()?.pValueCorrection ||
          pValueCorrection) ??
        null
      : null;

  const showVariations = experiment.variations.map(
    (v) => variationIds.length === 0 || variationIds.includes(v.id)
  );
  const variationNames = experiment.variations
    .filter(
      (variation) =>
        variationIds.length === 0 || variationIds.includes(variation.id)
    )
    .map(({ name }) => name);

  return (
    <div className="time-series-block">
      <ExperimentMetricTimeSeriesGraphWrapper
        experimentId={experiment.id}
        phase={snapshot.phase}
        experimentStatus={experiment.status}
        metric={metric}
        differenceType={analysis?.settings.differenceType || "relative"}
        showVariations={showVariations}
        variationNames={variationNames}
        statsEngine={statsEngine}
        pValueAdjustmentEnabled={!!appliedPValueCorrection}
        // TODO: Time series graph wrapper doesn't actually use firstDateToRender correctly
        firstDateToRender={new Date()}
      />
    </div>
  );
}
