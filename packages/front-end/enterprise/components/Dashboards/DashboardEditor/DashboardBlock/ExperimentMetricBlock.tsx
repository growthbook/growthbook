import React, { useMemo, useEffect } from "react";
import { v4 as uuid4 } from "uuid";
import {
  ExperimentMetricBlockInterface,
  blockHasFieldOfType,
} from "shared/enterprise";
import { isString } from "shared/util";
import { groupBy } from "lodash";
import { MetricSnapshotSettings } from "shared/types/report";
import { DEFAULT_PROPER_PRIOR_STDDEV } from "shared/constants";
import { expandMetricGroups } from "shared/experiments";
import useOrgSettings from "@/hooks/useOrgSettings";
import ResultsTable from "@/components/Experiment/ResultsTable";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useExperimentTableRows } from "@/hooks/useExperimentTableRows";
import { getRenderLabelColumn } from "@/components/Experiment/CompactResults";
import { getQueryStatus } from "@/components/Queries/RunQueriesButton";
import {
  useDashboardMetricSliceData,
  useDashboardPinnedMetricSlices,
} from "@/enterprise/hooks/useDashboardMetricSlices";
import { ExperimentMetricBlockContext } from "@/enterprise/components/Dashboards/DashboardEditor/DashboardEditorSidebar/types";
import { setBlockContextValue } from "@/enterprise/components/Dashboards/DashboardEditor/DashboardEditorSidebar/useBlockContext";
import { BlockProps } from ".";

export default function ExperimentMetricBlock({
  isTabActive,
  block,
  setBlock,
  experiment,
  snapshot,
  analysis,
  ssrPolyfills,
  isEditing,
  metrics,
}: BlockProps<ExperimentMetricBlockInterface>) {
  const {
    baselineRow,
    columnsFilter,
    variationIds,
    pinSource,
    metricSelector,
    metricIds: blockMetricIds,
  } = block;
  // The actual ID of the block which might be null in the case of a block being created
  const blockInherentId = useMemo(
    () => (blockHasFieldOfType(block, "id", isString) ? block.id : null),
    [block],
  );
  const blockId = useMemo(() => blockInherentId ?? uuid4(), [blockInherentId]);

  const { pValueCorrection: hookPValueCorrection } = useOrgSettings();
  const { metricGroups, getExperimentMetricById, getFactTableById } =
    useDefinitions();

  const statsEngine = analysis.settings.statsEngine;
  const pValueCorrection =
    ssrPolyfills?.useOrgSettings()?.pValueCorrection || hookPValueCorrection;
  const sequentialTestingEnabled = analysis?.settings?.sequentialTesting;

  const queryStatusData = getQueryStatus(
    snapshot.queries || [],
    snapshot.error,
  );

  const latestPhase = experiment.phases[experiment.phases.length - 1];
  const result = analysis.results[0];

  const settingsForSnapshotMetrics: MetricSnapshotSettings[] =
    snapshot?.settings?.metricSettings?.map((m) => ({
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

  const { expandedMetrics, toggleExpandedMetric, effectivePinnedMetricSlices } =
    useDashboardPinnedMetricSlices(block, experiment);

  const metricIds = metrics?.map((m) => m.id) || [];
  const goalMetrics = expandMetricGroups(
    experiment.goalMetrics,
    ssrPolyfills?.metricGroups || metricGroups,
  ).filter((mId) => metricIds.includes(mId));
  const secondaryMetrics = expandMetricGroups(
    experiment.secondaryMetrics,
    ssrPolyfills?.metricGroups || metricGroups,
  ).filter((mId) => metricIds.includes(mId) && !goalMetrics.includes(mId));
  const guardrailMetrics = expandMetricGroups(
    experiment.guardrailMetrics,
    ssrPolyfills?.metricGroups || metricGroups,
  ).filter(
    (mId) =>
      metricIds.includes(mId) &&
      !goalMetrics.includes(mId) &&
      !secondaryMetrics.includes(mId),
  );

  const { rows, getChildRowCounts } = useExperimentTableRows({
    results: result,
    goalMetrics,
    secondaryMetrics,
    guardrailMetrics,
    metricOverrides: experiment.metricOverrides ?? [],
    ssrPolyfills,
    customMetricSlices: experiment.customMetricSlices,
    pinnedMetricSlices: effectivePinnedMetricSlices,
    statsEngine,
    pValueCorrection,
    settingsForSnapshotMetrics,
    shouldShowMetricSlices: true,
    enableExpansion: true,
    enablePinning: true,
    expandedMetrics,
    sortBy: metricSelector === "custom" ? "custom" : null,
    customMetricOrder: metricSelector === "custom" ? blockMetricIds : undefined,
  });

  const { sliceData, togglePinnedMetricSlice, isSlicePinned } =
    useDashboardMetricSliceData(block, setBlock, rows);

  // Filter rows based on expansion state and pinned slices (no slice filter in dashboard blocks)
  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      if (!row.isSliceRow) return true; // Always include parent rows
      if (row.isPinned) return true; // Always include pinned rows
      // For slice rows, check if parent metric is expanded
      if (row.parentRowId) {
        const expandedKey = `${row.parentRowId}:${row.resultGroup}`;
        return !!expandedMetrics?.[expandedKey];
      }
      return true;
    });
  }, [rows, expandedMetrics]);

  const rowGroups = groupBy(filteredRows, ({ resultGroup }) => resultGroup);

  useEffect(() => {
    const contextValue: ExperimentMetricBlockContext = {
      type: "experiment-metric",
      sliceData,
      togglePinnedMetricSlice,
      isSlicePinned,
    };
    setBlockContextValue(blockInherentId, contextValue);

    return () => {
      setBlockContextValue(blockInherentId, null);
    };
  }, [blockInherentId, sliceData, togglePinnedMetricSlice, isSlicePinned]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 30 }}>
      {Object.entries(rowGroups).map(([resultGroup, rows]) =>
        !rows.length ? null : (
          <ResultsTable
            noStickyHeader
            key={resultGroup}
            id={blockId}
            experimentId={experiment.id}
            phase={experiment.phases.length - 1}
            variations={variations}
            variationFilter={variationFilter}
            baselineRow={baselineRow}
            columnsFilter={columnsFilter}
            status={experiment.status}
            isLatestPhase={true}
            startDate={latestPhase?.dateStarted || ""}
            endDate={latestPhase?.dateEnded || ""}
            rows={rows}
            tableRowAxis="metric"
            resultGroup={resultGroup as "goal" | "secondary" | "guardrail"}
            labelHeader={`${
              resultGroup.charAt(0).toUpperCase() + resultGroup.slice(1)
            } Metrics`}
            renderLabelColumn={getRenderLabelColumn({
              pinnedMetricSlices: effectivePinnedMetricSlices,
              togglePinnedMetricSlice: isEditing
                ? togglePinnedMetricSlice
                : undefined,
              expandedMetrics,
              toggleExpandedMetric: isEditing
                ? toggleExpandedMetric
                : undefined,
              getExperimentMetricById,
              getFactTableById,
              shouldShowMetricSlices: true,
              getChildRowCounts,
              pinSource,
            })}
            dateCreated={snapshot.dateCreated}
            statsEngine={statsEngine}
            sequentialTestingEnabled={sequentialTestingEnabled}
            pValueCorrection={pValueCorrection}
            differenceType={analysis?.settings?.differenceType || "relative"}
            queryStatusData={queryStatusData}
            isTabActive={isTabActive}
            isGoalMetrics={resultGroup === "goal"}
            ssrPolyfills={ssrPolyfills}
          />
        ),
      )}
    </div>
  );
}
