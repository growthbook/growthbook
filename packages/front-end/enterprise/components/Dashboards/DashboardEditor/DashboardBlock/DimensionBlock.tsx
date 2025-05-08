import React from "react";
import { DimensionBlockInterface } from "back-end/src/enterprise/validators/dashboard-block";
import { MetricSnapshotSettings } from "back-end/types/report";
import {
  DEFAULT_PROPER_PRIOR_STDDEV,
  DEFAULT_STATS_ENGINE,
} from "shared/constants";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useExperiments } from "@/hooks/useExperiments";
import LoadingSpinner from "@/components/LoadingSpinner";
import BreakDownResults from "@/components/Experiment/BreakDownResults";
import { getQueryStatus } from "@/components/Queries/RunQueriesButton";
import Callout from "@/components/Radix/Callout";
import { useDashboardSnapshot } from "../../DashboardSnapshotProvider";
import { BLOCK_TYPE_INFO } from "..";
import { BlockProps } from ".";

export default function DimensionBlock({
  block,
  setBlock,
}: BlockProps<DimensionBlockInterface>) {
  const {
    metricIds,
    experimentId,
    baselineRow,
    columnsFilter,
    variationIds,
    dimensionId,
    dimensionValues,
    differenceType,
  } = block;
  const { experimentsMap } = useExperiments();
  const experiment = experimentsMap.get(experimentId);

  const {
    snapshot,
    analysis,
    analysisSettings,
    loading,
  } = useDashboardSnapshot(block, setBlock);
  const orgSettings = useOrgSettings();
  const pValueCorrection = orgSettings?.pValueCorrection;

  if (loading) return <LoadingSpinner />;
  if (!dimensionId || metricIds.length === 0)
    return (
      <Callout status="info">
        This {BLOCK_TYPE_INFO[block.type].name} block requires additional
        configuration to display results.
      </Callout>
    );
  if (!snapshot) {
    return (
      <Callout status="info">No data yet. Refresh to populate results.</Callout>
    );
  }

  if (!experiment) return null;

  const variations = experiment.variations.map((v, i) => ({
    id: v.key || i + "",
    name: v.name,
    weight:
      experiment.phases[experiment.phases.length - 1]?.variationWeights?.[i] ||
      0,
  }));
  const indexedVariations = experiment.variations.map((v, i) => ({
    ...v,
    index: i,
  }));

  const variationFilter =
    variationIds && variationIds.length > 0
      ? indexedVariations
          .filter((v) => !variationIds.includes(v.id))
          .map((v) => v.index)
      : undefined;

  const latestPhase = experiment.phases[experiment.phases.length - 1];

  if (!analysis) return null;

  const queryStatusData = getQueryStatus(
    snapshot.queries || [],
    snapshot.error
  );

  const settingsForSnapshotMetrics: MetricSnapshotSettings[] =
    snapshot.settings.metricSettings.map((m) => ({
      metric: m.id,
      properPrior: m.computedSettings?.properPrior ?? false,
      properPriorMean: m.computedSettings?.properPriorMean ?? 0,
      properPriorStdDev:
        m.computedSettings?.properPriorStdDev ?? DEFAULT_PROPER_PRIOR_STDDEV,
      regressionAdjustmentReason:
        m.computedSettings?.regressionAdjustmentReason || "",
      regressionAdjustmentDays:
        m.computedSettings?.regressionAdjustmentDays || 0,
      regressionAdjustmentEnabled: !!m.computedSettings
        ?.regressionAdjustmentEnabled,
      regressionAdjustmentAvailable: !!m.computedSettings
        ?.regressionAdjustmentAvailable,
    })) || [];
  const isBandit = experiment.type === "multi-armed-bandit";

  const goalMetrics = experiment.goalMetrics.filter((mId) =>
    metricIds.includes(mId)
  );
  const secondaryMetrics = experiment.secondaryMetrics.filter((mId) =>
    metricIds.includes(mId)
  );
  const guardrailMetrics = experiment.guardrailMetrics.filter((mId) =>
    metricIds.includes(mId)
  );

  return (
    <BreakDownResults
      key={snapshot.dimension}
      results={analysis.results}
      queryStatusData={queryStatusData}
      variations={variations}
      variationFilter={variationFilter}
      baselineRow={baselineRow}
      columnsFilter={columnsFilter}
      goalMetrics={goalMetrics}
      secondaryMetrics={secondaryMetrics}
      guardrailMetrics={guardrailMetrics}
      metricOverrides={experiment.metricOverrides ?? []}
      dimensionId={dimensionId}
      dimensionValuesFilter={dimensionValues}
      isLatestPhase={true}
      phase={experiment.phases.length - 1}
      startDate={latestPhase.dateStarted ?? ""}
      endDate={latestPhase.dateEnded ?? ""}
      reportDate={snapshot.dateCreated}
      activationMetric={experiment.activationMetric}
      status={experiment.status}
      statsEngine={analysisSettings?.statsEngine || DEFAULT_STATS_ENGINE}
      pValueCorrection={pValueCorrection}
      regressionAdjustmentEnabled={analysisSettings?.regressionAdjusted}
      settingsForSnapshotMetrics={settingsForSnapshotMetrics}
      sequentialTestingEnabled={analysisSettings?.sequentialTesting}
      differenceType={differenceType}
      isBandit={isBandit}
    />
  );
}
