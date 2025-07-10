import { TimeSeriesBlockInterface } from "back-end/src/enterprise/validators/dashboard-block";
import { isDefined } from "shared/util";
import ExperimentMetricTimeSeriesGraphWrapper from "@/components/Experiment/ExperimentMetricTimeSeriesGraphWrapper";
import { useDefinitions } from "@/services/DefinitionsContext";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useExperiments } from "@/hooks/useExperiments";
import Callout from "@/components/Radix/Callout";
import { useDashboardSnapshot } from "../../DashboardSnapshotProvider";
import { BlockProps } from ".";

export default function TimeSeriesBlock({
  block,
  setBlock,
  isEditing,
}: BlockProps<TimeSeriesBlockInterface>) {
  const { experimentId, metricId, variationIds } = block;
  const { experimentsMap } = useExperiments();
  const experiment = experimentsMap.get(experimentId);
  const { snapshot, analysisSettings } = useDashboardSnapshot(block, setBlock);
  const orgSettings = useOrgSettings();
  const pValueCorrection = orgSettings?.pValueCorrection;
  const { getExperimentMetricById } = useDefinitions();
  const showVariations = (experiment?.variations || []).map((v) =>
    variationIds.includes(v.id)
  );

  const metric = getExperimentMetricById(metricId);

  if (!metric) {
    return isEditing ? (
      <Callout status="warning">Please select a metric</Callout>
    ) : null;
  }
  if (!snapshot) {
    return (
      <Callout status="info">
        No data yet - please refresh the dashboard to populate results
      </Callout>
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

  const variationNames =
    variationIds
      ?.map(
        (id) =>
          experiment.variations.find((variation) => variation.id === id)?.name
      )
      ?.filter(isDefined) || [];
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
