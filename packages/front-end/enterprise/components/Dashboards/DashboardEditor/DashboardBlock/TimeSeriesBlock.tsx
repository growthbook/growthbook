import { TimeSeriesBlockInterface } from "back-end/src/enterprise/validators/dashboard-block";
import ExperimentMetricTimeSeriesGraphWrapper from "@/components/Experiment/ExperimentMetricTimeSeriesGraphWrapper";
import { useDefinitions } from "@/services/DefinitionsContext";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useExperiments } from "@/hooks/useExperiments";
import Callout from "@/components/Radix/Callout";
import { useDashboardSnapshot } from "../../DashboardSnapshotProvider";
import { BLOCK_TYPE_INFO } from "..";
import { BlockProps } from ".";

export default function TimeSeriesBlock({
  block,
  setBlock,
}: BlockProps<TimeSeriesBlockInterface>) {
  const { experimentId, metricId, variationIds } = block;
  const { experimentsMap } = useExperiments();
  const experiment = experimentsMap.get(experimentId);
  const { snapshot, analysisSettings } = useDashboardSnapshot(block, setBlock);
  const orgSettings = useOrgSettings();
  const pValueCorrection = orgSettings?.pValueCorrection;
  const { getExperimentMetricById } = useDefinitions();

  const metric = getExperimentMetricById(metricId);

  if (!metric) {
    return (
      <Callout status="info">
        This {BLOCK_TYPE_INFO[block.type].name} block requires additional
        configuration to display results.
      </Callout>
    );
  }
  if (!snapshot) {
    return (
      <Callout status="info">No data yet. Refresh to populate results.</Callout>
    );
  }

  if (!experiment) return null;

  // Determine which group the metric belongs to
  let resultGroup: "goal" | "secondary" | "guardrail" = "goal";
  if (experiment.secondaryMetrics.includes(metricId)) {
    resultGroup = "secondary";
  } else if (experiment.guardrailMetrics.includes(metricId)) {
    resultGroup = "guardrail";
  }

  const appliedPValueCorrection =
    resultGroup === "goal" ? pValueCorrection ?? null : null;

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
        differenceType={analysisSettings?.differenceType || "relative"}
        showVariations={showVariations}
        variationNames={variationNames}
        statsEngine={orgSettings?.statsEngine || "frequentist"}
        pValueAdjustmentEnabled={!!appliedPValueCorrection}
        // TODO: Time series graph wrapper doesn't actually use firstDateToRender correctly
        firstDateToRender={new Date()}
      />
    </div>
  );
}
