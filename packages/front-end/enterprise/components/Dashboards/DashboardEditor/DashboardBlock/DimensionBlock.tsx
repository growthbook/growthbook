import React, { useMemo } from "react";
import { DimensionBlockInterface } from "back-end/src/enterprise/validators/dashboard-block";
import { MetricSnapshotSettings } from "back-end/types/report";
import {
  DEFAULT_PROPER_PRIOR_STDDEV,
  DEFAULT_STATS_ENGINE,
} from "shared/constants";
import { expandMetricGroups } from "shared/experiments";
import useOrgSettings from "@/hooks/useOrgSettings";
import BreakDownResults from "@/components/Experiment/BreakDownResults";
import { getQueryStatus } from "@/components/Queries/RunQueriesButton";
import { useDefinitions } from "@/services/DefinitionsContext";
import { BlockProps } from ".";

export default function DimensionBlock({
  block: {
    metricIds,
    baselineRow,
    columnsFilter,
    variationIds,
    dimensionId,
    dimensionValues,
    differenceType,
  },
  experiment,
  snapshot,
  analysis,
  ssrPolyfills,
}: BlockProps<DimensionBlockInterface>) {
  const { pValueCorrection: hookPValueCorrection } = useOrgSettings();
  const { metricGroups } = useDefinitions();
  const expGoalMetrics = useMemo(
    () => expandMetricGroups(experiment.goalMetrics, metricGroups),
    [experiment, metricGroups]
  );
  const expSecondaryMetrics = useMemo(
    () => expandMetricGroups(experiment.secondaryMetrics, metricGroups),
    [experiment, metricGroups]
  );
  const expGuardrailMetrics = useMemo(
    () => expandMetricGroups(experiment.guardrailMetrics, metricGroups),
    [experiment, metricGroups]
  );

  const pValueCorrection =
    ssrPolyfills?.useOrgSettings()?.pValueCorrection || hookPValueCorrection;

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

  const goalMetrics = expGoalMetrics.filter((mId) => metricIds.includes(mId));
  const secondaryMetrics = expSecondaryMetrics.filter((mId) =>
    metricIds.includes(mId)
  );
  const guardrailMetrics = expGuardrailMetrics.filter((mId) =>
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
      statsEngine={analysis?.settings?.statsEngine || DEFAULT_STATS_ENGINE}
      pValueCorrection={pValueCorrection}
      regressionAdjustmentEnabled={analysis?.settings?.regressionAdjusted}
      settingsForSnapshotMetrics={settingsForSnapshotMetrics}
      sequentialTestingEnabled={analysis?.settings?.sequentialTesting}
      differenceType={differenceType}
      isBandit={isBandit}
    />
  );
}
