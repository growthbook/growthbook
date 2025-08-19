import React, { useMemo } from "react";
import { v4 as uuid4 } from "uuid";
import { ExperimentDimensionBlockInterface } from "back-end/src/enterprise/validators/dashboard-block";
import { MetricSnapshotSettings } from "back-end/types/report";
import {
  DEFAULT_PROPER_PRIOR_STDDEV,
  DEFAULT_STATS_ENGINE,
} from "shared/constants";
import { expandMetricGroups } from "shared/experiments";
import { blockHasFieldOfType } from "shared/enterprise";
import { isString } from "shared/util";
import useOrgSettings from "@/hooks/useOrgSettings";
import BreakDownResults from "@/components/Experiment/BreakDownResults";
import { getQueryStatus } from "@/components/Queries/RunQueriesButton";
import { useDefinitions } from "@/services/DefinitionsContext";
import { BlockProps } from ".";

export default function ExperimentDimensionBlock({
  block,
  experiment,
  snapshot,
  analysis,
  ssrPolyfills,
}: BlockProps<ExperimentDimensionBlockInterface>) {
  const {
    metricIds,
    baselineRow,
    columnsFilter,
    variationIds,
    dimensionId,
    dimensionValues,
    differenceType,
  } = block;
  const blockId = useMemo(
    () => (blockHasFieldOfType(block, "id", isString) ? block.id : uuid4()),
    [block],
  );

  const { pValueCorrection: hookPValueCorrection } = useOrgSettings();
  const { metricGroups } = useDefinitions();
  const expandedMetricIds = expandMetricGroups(metricIds, metricGroups);
  const expGoalMetrics = expandMetricGroups(
    experiment.goalMetrics,
    metricGroups,
  );
  const expSecondaryMetrics = expandMetricGroups(
    experiment.secondaryMetrics,
    metricGroups,
  );
  const expGuardrailMetrics = expandMetricGroups(
    experiment.guardrailMetrics,
    metricGroups,
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
    snapshot.error,
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
      regressionAdjustmentEnabled:
        !!m.computedSettings?.regressionAdjustmentEnabled,
      regressionAdjustmentAvailable:
        !!m.computedSettings?.regressionAdjustmentAvailable,
    })) || [];

  const goalMetrics = expGoalMetrics.filter((mId) =>
    expandedMetricIds.includes(mId),
  );
  const secondaryMetrics = expSecondaryMetrics.filter((mId) =>
    expandedMetricIds.includes(mId),
  );
  const guardrailMetrics = expGuardrailMetrics.filter((mId) =>
    expandedMetricIds.includes(mId),
  );

  return (
    <BreakDownResults
      idPrefix={blockId}
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
      renderMetricName={(metric) => metric.name}
    />
  );
}
