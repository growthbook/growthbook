import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { ExperimentMetricInterface } from "shared/experiments";
import { DifferenceType } from "back-end/types/stats";
import { useDefinitions } from "@/services/DefinitionsContext";
import DimensionChooser from "@/components/Dimensions/DimensionChooser";
import { useSnapshot } from "@/components/Experiment/SnapshotProvider";
import BaselineChooser from "@/components/Experiment/BaselineChooser";
import VariationChooser from "@/components/Experiment/VariationChooser";
import ResultsTable from "@/components/Experiment/ResultsTable";
import useOrgSettings from "@/hooks/useOrgSettings";
import { MetricSelector } from "./MetricBlock";
import { Block } from "./index";

export default function DimensionBlock({
  dimensionId,
  dimensionValues,
  baselineRow,
  variationIds,
  metricId,
  isEditing,
  setBlock,
  experiment,
  differenceType,
}: {
  dimensionId: string;
  dimensionValues: string[];
  baselineRow: number;
  variationIds: string[];
  metricId: string;
  isEditing: boolean;
  setBlock: (block: Block) => void;
  experiment: ExperimentInterfaceStringDates;
  differenceType: DifferenceType;
}) {
  const {
    snapshot,
    analysis,
    mutateSnapshot,
    analysisSettings,
    setAnalysisSettings,
    setDimension,
  } = useSnapshot();
  const orgSettings = useOrgSettings();
  const pValueCorrection = orgSettings?.pValueCorrection;

  const { getExperimentMetricById } = useDefinitions();

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
      type: "dimension",
      metricId: value,
      dimensionId: "",
      variationIds: experiment.variations.map((v) => v.key || ""),
      dimensionValues: [],
      baselineRow,
      differenceType,
    });

  const setDimensionId = (value: string) => {
    setDimension(value);
    setBlock({
      type: "dimension",
      metricId,
      dimensionId: value,
      variationIds: variationIds,
      dimensionValues: [], // todo - get all dimension values
      baselineRow,
      differenceType,
    });
  };

  const setVariationFilter = (variations: number[]) => {
    setBlock({
      type: "dimension",
      metricId,
      dimensionId,
      variationIds: variations.map(toString),
      dimensionValues,
      baselineRow,
      differenceType,
    });
  };

  const setBaselineRow = (row: number) =>
    setBlock({
      type: "dimension",
      metricId,
      dimensionId,
      variationIds,
      dimensionValues,
      baselineRow: row,
      differenceType,
    });

  const setDifferenceType = (value: DifferenceType) =>
    setBlock({
      type: "dimension",
      metricId,
      dimensionId,
      variationIds,
      dimensionValues,
      baselineRow,
      differenceType: value,
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

  const variations = experiment.variations.map((v, i) => ({
    id: v.key || i + "",
    name: v.name,
    weight:
      experiment.phases[experiment.phases.length - 1]?.variationWeights?.[i] ||
      0,
  }));

  const latestPhase = experiment.phases[experiment.phases.length - 1];
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

  return (
    <div className="dimension-block">
      {isEditing && (
        <MetricSelector
          metricId={metricId}
          setMetricId={setMetricId}
          options={metricOptions}
        />
      )}

      <div className="col-auto form-inline">
        <BaselineChooser
          dropdownEnabled={isEditing}
          variations={experiment.variations}
          setVariationFilter={setVariationFilter}
          setAnalysisSettings={setAnalysisSettings}
          baselineRow={baselineRow}
          setBaselineRow={setBaselineRow}
          snapshot={snapshot}
          analysis={analysis}
          mutate={mutateSnapshot}
        />
        <em className="text-muted mx-3" style={{ marginTop: 15 }}>
          vs
        </em>
        <VariationChooser
          dropdownEnabled={isEditing}
          variations={experiment.variations}
          variationFilter={variationIds.map(parseInt)}
          setVariationFilter={setVariationFilter}
          baselineRow={baselineRow}
        />
        <DimensionChooser
          value={dimensionId}
          setValue={setDimensionId}
          activationMetric={!!experiment.activationMetric}
          datasourceId={experiment.datasource}
          exposureQueryId={experiment.exposureQueryId}
          userIdType={experiment.userIdType}
          labelClassName="mr-2"
          setVariationFilter={setVariationFilter}
          setBaselineRow={setBaselineRow}
          setDifferenceType={setDifferenceType}
          setAnalysisSettings={setAnalysisSettings}
        />
      </div>
      <ResultsTable
        id={experiment.id}
        variations={variations}
        status={experiment.status}
        isLatestPhase={true}
        startDate={latestPhase?.dateStarted || ""}
        endDate={latestPhase?.dateEnded || ""}
        rows={rows}
        tableRowAxis="metric"
        labelHeader={`${
          resultGroup.charAt(0).toUpperCase() + resultGroup.slice(1)
        } Metrics`}
        renderLabelColumn={(label) => label}
        dateCreated={new Date()}
        hasRisk={false}
        statsEngine={orgSettings?.statsEngine || "frequentist"}
        pValueCorrection={pValueCorrection}
        differenceType={analysisSettings?.differenceType || "relative"}
        isTabActive={true}
        isGoalMetrics={resultGroup === "goal"}
      />
    </div>
  );
}
