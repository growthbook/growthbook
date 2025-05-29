import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { getValidDate } from "shared/dates";
import { ExperimentMetricInterface } from "shared/experiments";
import ExperimentMetricTimeSeriesGraphWrapper from "@/components/Experiment/ExperimentMetricTimeSeriesGraphWrapper";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useSnapshot } from "@/components/Experiment/SnapshotProvider";
import useOrgSettings from "@/hooks/useOrgSettings";
import { MetricSelector } from "./MetricBlock";
import { Block } from ".";

export default function TimeSeriesBlock({
  experiment,
  metricId,
  variationIds,
  dateStart,
  dateEnd,
  isEditing,
  setBlock,
}: {
  experiment: ExperimentInterfaceStringDates;
  metricId: string;
  variationIds: string[];
  dateStart: Date;
  dateEnd: Date;
  isEditing: boolean;
  setBlock: (block: Block) => void;
}) {
  const { snapshot, analysisSettings } = useSnapshot();
  const orgSettings = useOrgSettings();
  const pValueCorrection = orgSettings?.pValueCorrection;
  const { getExperimentMetricById } = useDefinitions();
  const showVariations = experiment.variations.map((v) =>
    variationIds.includes(v.id)
  );

  const goalMetrics = experiment.goalMetrics
    .map((id) => getExperimentMetricById(id))
    .filter(Boolean) as ExperimentMetricInterface[];
  const secondaryMetrics = experiment.secondaryMetrics
    .map((id) => getExperimentMetricById(id))
    .filter(Boolean) as ExperimentMetricInterface[];
  const guardrailMetrics = experiment.guardrailMetrics
    .map((id) => getExperimentMetricById(id))
    .filter(Boolean) as ExperimentMetricInterface[];
  const metricOptions = [
    {
      label: "Goal Metrics",
      options: goalMetrics.map((m) => ({ label: m.name, value: m.id })),
    },
    {
      label: "Secondary Metrics",
      options: secondaryMetrics.map((m) => ({ label: m.name, value: m.id })),
    },
    {
      label: "Guardrail Metrics",
      options: guardrailMetrics.map((m) => ({ label: m.name, value: m.id })),
    },
  ];

  const setMetricId = (value: string) =>
    setBlock({
      type: "time-series",
      metricId: value,
      variationIds: experiment.variations.map((v) => v.id || ""),
      dateStart,
      dateEnd,
    });

  const metric = getExperimentMetricById(metricId);

  if (!metric && isEditing) {
    return (
      <MetricSelector
        metricId={metricId}
        setMetricId={setMetricId}
        options={metricOptions}
      />
    );
  }

  if (!metric) {
    return null;
  }

  const latestResults = snapshot?.analyses?.[0]?.results?.[0];

  // Determine which group the metric belongs to
  let resultGroup: "goal" | "secondary" | "guardrail" = "goal";
  if (experiment.secondaryMetrics.includes(metricId)) {
    resultGroup = "secondary";
  } else if (experiment.guardrailMetrics.includes(metricId)) {
    resultGroup = "guardrail";
  }

  const rows = [
    {
      label: metric.name,
      metric,
      variations:
        latestResults?.variations?.map((v) => ({
          value: v.metrics[metricId]?.value || 0,
          cr: v.metrics[metricId]?.cr || 0,
          users: v.users,
          denominator: v.metrics[metricId]?.denominator,
          ci: v.metrics[metricId]?.ci,
          ciAdjusted: v.metrics[metricId]?.ciAdjusted,
          expected: v.metrics[metricId]?.expected,
          risk: v.metrics[metricId]?.risk,
          riskType: v.metrics[metricId]?.riskType,
          stats: v.metrics[metricId]?.stats,
          pValue: v.metrics[metricId]?.pValue,
          pValueAdjusted: v.metrics[metricId]?.pValueAdjusted,
          uplift: v.metrics[metricId]?.uplift,
          buckets: v.metrics[metricId]?.buckets,
          chanceToWin: v.metrics[metricId]?.chanceToWin,
          errorMessage: v.metrics[metricId]?.errorMessage,
          power: v.metrics[metricId]?.power,
        })) || [],
      resultGroup,
      metricOverrideFields: [],
    },
  ];

  const hasGoalMetrics = rows.some((r) => r.resultGroup === "goal");

  const appliedPValueCorrection = hasGoalMetrics
    ? pValueCorrection ?? null
    : null;

  return (
    <div className="time-series-block">
      {isEditing && (
        <MetricSelector
          metricId={metricId}
          setMetricId={setMetricId}
          options={metricOptions}
        />
      )}
      <ExperimentMetricTimeSeriesGraphWrapper
        experimentId={experiment.id}
        experimentStatus={experiment.status}
        metric={metric}
        differenceType={analysisSettings?.differenceType || "relative"}
        showVariations={showVariations}
        statsEngine={orgSettings?.statsEngine || "frequentist"}
        pValueAdjustmentEnabled={!!appliedPValueCorrection && rows.length > 1}
        firstDateToRender={getValidDate(dateStart)}
      />
    </div>
  );
}
