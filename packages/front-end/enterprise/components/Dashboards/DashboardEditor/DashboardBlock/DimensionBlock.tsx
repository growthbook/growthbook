import { DifferenceType } from "back-end/types/stats";
import { DimensionBlockInterface } from "back-end/src/enterprise/validators/dashboard-block";
import { useDefinitions } from "@/services/DefinitionsContext";
import DimensionChooser from "@/components/Dimensions/DimensionChooser";
import BaselineChooser from "@/components/Experiment/BaselineChooser";
import VariationChooser from "@/components/Experiment/VariationChooser";
import ResultsTable from "@/components/Experiment/ResultsTable";
import useOrgSettings from "@/hooks/useOrgSettings";
import { ExperimentMetricSelector } from "../DashboardSettingsHeader";
import { useDashboardSnapshot } from "../../DashboardSnapshotProvider";
import { withExperiment, BlockProps } from ".";

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
}: withExperiment<BlockProps<DimensionBlockInterface>>) {
  variationIds ||= [];
  baselineRow ||= 0;
  metricId ||= "";
  dimensionId ||= "";
  const {
    snapshot,
    analysis,
    mutateSnapshot,
    analysisSettings,
  } = useDashboardSnapshot();
  const orgSettings = useOrgSettings();
  const pValueCorrection = orgSettings?.pValueCorrection;

  const { getExperimentMetricById } = useDefinitions();

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

  const updateDimensionId = (value: string) => {
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
      <ExperimentMetricSelector
        metricId={metricId}
        setMetricId={setMetricId}
        experiment={experiment}
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
        <ExperimentMetricSelector
          metricId={metricId}
          setMetricId={setMetricId}
          experiment={experiment}
        />
      )}

      <div className="col-auto form-inline">
        <BaselineChooser
          dropdownEnabled={isEditing}
          variations={experiment.variations}
          setVariationFilter={setVariationFilter}
          setAnalysisSettings={() => {}}
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
          setValue={updateDimensionId}
          activationMetric={!!experiment.activationMetric}
          datasourceId={experiment.datasource}
          exposureQueryId={experiment.exposureQueryId}
          userIdType={experiment.userIdType}
          labelClassName="mr-2"
          setVariationFilter={setVariationFilter}
          setBaselineRow={setBaselineRow}
          setDifferenceType={setDifferenceType}
          setAnalysisSettings={() => {}}
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
