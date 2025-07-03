import { getValidDate } from "shared/dates";
import { TimeSeriesBlockInterface } from "back-end/src/enterprise/validators/dashboard-block";
import { isDefined } from "shared/util";
import ExperimentMetricTimeSeriesGraphWrapper from "@/components/Experiment/ExperimentMetricTimeSeriesGraphWrapper";
import { useDefinitions } from "@/services/DefinitionsContext";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useExperiments } from "@/hooks/useExperiments";
import { useDashboardSnapshot } from "../../DashboardSnapshotProvider";
import { BlockProps } from ".";

export default function TimeSeriesBlock({
  block,
}: BlockProps<TimeSeriesBlockInterface>) {
  const { experimentId, metricId, variationIds, dateStart } = block;
  const { experimentsMap } = useExperiments();
  const experiment = experimentsMap.get(experimentId);
  const { snapshot, analysisSettings } = useDashboardSnapshot(block);
  const orgSettings = useOrgSettings();
  const pValueCorrection = orgSettings?.pValueCorrection;
  const { getExperimentMetricById } = useDefinitions();
  const showVariations = (experiment?.variations || []).map((v) =>
    variationIds.includes(v.id)
  );

  const metric = getExperimentMetricById(metricId);

  if (!experiment || !metric || !snapshot) return null;

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
        firstDateToRender={getValidDate(dateStart)}
      />
    </div>
  );
}
