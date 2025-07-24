import { TimeSeriesBlockInterface } from "back-end/src/enterprise/validators/dashboard-block";
import { expandMetricGroups } from "shared/experiments";
import ExperimentMetricTimeSeriesGraphWrapper from "@/components/Experiment/ExperimentMetricTimeSeriesGraphWrapper";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useDefinitions } from "@/services/DefinitionsContext";
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
  const { metricGroups } = useDefinitions();
  const secondaryMetrics = expandMetricGroups(
    experiment.secondaryMetrics,
    metricGroups
  );
  const guardrailMetrics = expandMetricGroups(
    experiment.guardrailMetrics,
    metricGroups
  );

  const statsEngine =
    ssrPolyfills?.useOrgSettings()?.statsEngine ||
    hookStatsEngine ||
    "frequentist";

  // Determine which group the metric belongs to
  let resultGroup: "goal" | "secondary" | "guardrail" = "goal";
  if (secondaryMetrics.includes(metric.id)) {
    resultGroup = "secondary";
  } else if (guardrailMetrics.includes(metric.id)) {
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
