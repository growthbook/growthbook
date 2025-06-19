import React from "react";
import { MetricBlockInterface } from "back-end/src/enterprise/validators/dashboard-block";
import { useDefinitions } from "@/services/DefinitionsContext";
import useOrgSettings from "@/hooks/useOrgSettings";
import ResultsTable from "@/components/Experiment/ResultsTable";
import BaselineChooser from "@/components/Experiment/BaselineChooser";
import VariationChooser from "@/components/Experiment/VariationChooser";
import { useDashboardSettings } from "../../DashboardSettingsProvider";
import { ExperimentMetricSelector } from "../DashboardSettingsHeader";
import { useDashboardSnapshot } from "../../DashboardSnapshotProvider";
import { BlockProps, withExperiment } from ".";

export default function MetricBlock({
  metricId: metricIdOverride,
  variationIds: variationIdsOverride,
  baselineRow: baselineRowOverride,
  isEditing,
  setBlock,
  experiment,
}: withExperiment<BlockProps<MetricBlockInterface>>) {
  const {
    defaultAnalysisSettings: { baselineVariationIndex: defaultBaselineRow },
    defaultMetricId,
    defaultVariationIds,
  } = useDashboardSettings();
  const metricId = metricIdOverride || defaultMetricId;
  const baselineRow = baselineRowOverride || defaultBaselineRow;
  const variationIds = variationIdsOverride || defaultVariationIds;
  const { getExperimentMetricById } = useDefinitions();
  const {
    snapshot,
    analysis,
    mutateSnapshot,
    analysisSettings,
  } = useDashboardSnapshot();
  const orgSettings = useOrgSettings();
  const pValueCorrection = orgSettings?.pValueCorrection;

  const metric = getExperimentMetricById(metricId);

  const setMetricId = (value: string) =>
    setBlock({
      type: "metric",
      metricId: value,
      variationIds: variationIdsOverride,
      baselineRow: baselineRowOverride,
    });

  const setVariationFilter = (variations: number[]) => {
    setBlock({
      type: "metric",
      metricId: metricIdOverride,
      variationIds: variations.map(toString),
      baselineRow: baselineRowOverride,
    });
  };

  const setBaselineRow = (row: number) =>
    setBlock({
      type: "metric",
      metricId: metricIdOverride,
      variationIds: variationIdsOverride,
      baselineRow: row,
    });

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
    <div className="metric-block">
      {isEditing && (
        <ExperimentMetricSelector
          metricId={metricId}
          setMetricId={setMetricId}
          experiment={experiment}
        />
      )}
      <div className="row align-items-center mb-3">
        <div className="col-auto form-inline">
          <BaselineChooser
            dropdownEnabled={isEditing}
            variations={experiment.variations}
            setVariationFilter={setVariationFilter}
            setAnalysisSettings={() => {}}
            baselineRow={baselineRow}
            setBaselineRow={setBaselineRow}
            snapshot={snapshot}
            analysis={analysis || undefined}
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
        </div>
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
