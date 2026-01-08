import React, { useMemo } from "react";
import { v4 as uuid4 } from "uuid";
import {
  ExperimentDimensionBlockInterface,
  blockHasFieldOfType,
  filterMetricsBySelector,
} from "shared/enterprise";
import { MetricSnapshotSettings } from "shared/types/report";
import {
  DEFAULT_PROPER_PRIOR_STDDEV,
  DEFAULT_STATS_ENGINE,
} from "shared/constants";
import { isString } from "shared/util";
import useOrgSettings from "@/hooks/useOrgSettings";
import BreakDownResults from "@/components/Experiment/BreakDownResults";
import { getQueryStatus } from "@/components/Queries/RunQueriesButton";
import { useDashboardEditorHooks } from "@/enterprise/hooks/useDashboardEditorHooks";
import { BlockProps } from ".";

export default function ExperimentDimensionBlock({
  block,
  experiment,
  snapshot,
  analysis,
  ssrPolyfills,
  isEditing,
  setBlock,
}: BlockProps<ExperimentDimensionBlockInterface>) {
  const {
    columnsFilter,
    dimensionId,
    dimensionValues,
    metricSelector,
    metricIds: blockMetricIds,
    metricTagFilter: blockMetricTagFilter,
    sortBy: blockSortBy,
    sortDirection: blockSortDirection,
  } = block;

  // The actual ID of the block which might be null in the case of a block being created
  const blockInherentId = useMemo(
    () => (blockHasFieldOfType(block, "id", isString) ? block.id : null),
    [block],
  );
  const blockId = useMemo(() => blockInherentId ?? uuid4(), [blockInherentId]);

  const { pValueCorrection: hookPValueCorrection } = useOrgSettings();

  const pValueCorrection =
    ssrPolyfills?.useOrgSettings()?.pValueCorrection || hookPValueCorrection;

  const variations = experiment.variations.map((v, i) => ({
    id: v.key || i + "",
    name: v.name,
    weight:
      experiment.phases[experiment.phases.length - 1]?.variationWeights?.[i] ||
      0,
  }));

  // Use shared editor hooks for state management
  const {
    baselineRow,
    variationFilter,
    differenceType,
    setSortBy,
    setSortDirection,
    setBaselineRow,
    setVariationFilter,
    setDifferenceType,
  } = useDashboardEditorHooks(block, setBlock, variations);

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

  const { goalMetrics, secondaryMetrics, guardrailMetrics } =
    filterMetricsBySelector({
      goalMetrics: experiment.goalMetrics,
      secondaryMetrics: experiment.secondaryMetrics,
      guardrailMetrics: experiment.guardrailMetrics,
      metricSelector: metricSelector,
    });

  return (
    <BreakDownResults
      experimentId={experiment.id}
      noStickyHeader
      idPrefix={blockId}
      key={snapshot.dimension}
      results={analysis.results}
      queryStatusData={queryStatusData}
      variations={variations}
      variationFilter={variationFilter}
      setVariationFilter={isEditing ? setVariationFilter : undefined}
      baselineRow={baselineRow}
      setBaselineRow={isEditing ? setBaselineRow : undefined}
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
      settingsForSnapshotMetrics={settingsForSnapshotMetrics}
      sequentialTestingEnabled={analysis?.settings?.sequentialTesting}
      differenceType={differenceType}
      setDifferenceType={isEditing ? setDifferenceType : undefined}
      renderMetricName={(metric) => metric.name}
      showErrorsOnQuantileMetrics={analysis?.settings?.dimensions.some((d) =>
        d.startsWith("precomputed:"),
      )}
      sortBy={blockSortBy === "metricIds" ? "custom" : (blockSortBy ?? null)}
      setSortBy={
        isEditing && setSortBy
          ? (value: "significance" | "change" | "custom" | null) => {
              setSortBy(value as "significance" | "change" | null);
            }
          : undefined
      }
      sortDirection={blockSortDirection ?? null}
      setSortDirection={isEditing ? setSortDirection : undefined}
      customMetricOrder={
        blockSortBy === "metricIds" &&
        blockMetricIds &&
        blockMetricIds.length > 0
          ? blockMetricIds
          : undefined
      }
      metricTagFilter={blockMetricTagFilter}
    />
  );
}
