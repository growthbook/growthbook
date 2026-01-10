import React, { useMemo } from "react";
import { v4 as uuid4 } from "uuid";
import {
  ExperimentMetricBlockInterface,
  blockHasFieldOfType,
} from "shared/enterprise";
import { isString } from "shared/util";
import { groupBy } from "lodash";
import { MetricSnapshotSettings } from "shared/types/report";
import { DEFAULT_PROPER_PRIOR_STDDEV } from "shared/constants";
import useOrgSettings from "@/hooks/useOrgSettings";
import ResultsTable from "@/components/Experiment/ResultsTable";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useExperimentTableRows } from "@/hooks/useExperimentTableRows";
import { getRenderLabelColumn } from "@/components/Experiment/CompactResults";
import { getQueryStatus } from "@/components/Queries/RunQueriesButton";
import { useDashboardEditorHooks } from "@/enterprise/hooks/useDashboardEditorHooks";
import { BlockProps } from ".";

export default function ExperimentMetricBlock({
  isTabActive,
  block,
  experiment,
  snapshot,
  analysis,
  ssrPolyfills,
  isEditing,
  setBlock,
}: BlockProps<ExperimentMetricBlockInterface>) {
  const {
    columnsFilter,
    metricIds: blockMetricIds,
    sliceTagsFilter: blockSliceTagsFilter,
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
  const { getExperimentMetricById, getFactTableById } = useDefinitions();

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

  // Use shared editor hooks for state management
  const {
    sortBy,
    sortDirection,
    baselineRow,
    variationFilter,
    differenceType,
    expandedMetrics,
    toggleExpandedMetric,
    setSortBy,
    setSortDirection,
    setBaselineRow,
    setVariationFilter,
    setDifferenceType,
  } = useDashboardEditorHooks(block, setBlock, variations);

  const { rows, getChildRowCounts } = useExperimentTableRows({
    results: result,
    goalMetrics: experiment.goalMetrics,
    secondaryMetrics: experiment.secondaryMetrics,
    guardrailMetrics: experiment.guardrailMetrics,
    metricOverrides: experiment.metricOverrides ?? [],
    ssrPolyfills,
    customMetricSlices: experiment.customMetricSlices,
    metricTagFilter: blockMetricTagFilter,
    metricsFilter: blockMetricIds,
    sliceTagsFilter: blockSliceTagsFilter,
    statsEngine,
    pValueCorrection,
    settingsForSnapshotMetrics,
    shouldShowMetricSlices: true,
    enableExpansion: true,
    expandedMetrics,
    sortBy:
      blockSortBy === "metricIds"
        ? "custom"
        : sortBy === "significance" || sortBy === "change"
          ? sortBy
          : null,
    sortDirection: blockSortBy !== "metricIds" ? sortDirection : undefined,
    customMetricOrder:
      blockSortBy === "metricIds" && blockMetricIds && blockMetricIds.length > 0
        ? blockMetricIds.filter(
            (id) =>
              ![
                "experiment-goal",
                "experiment-secondary",
                "experiment-guardrail",
              ].includes(id),
          )
        : undefined,
  });

  // Filter rows based on expansion state when there's no slice filter
  const hasSliceFilter =
    blockSliceTagsFilter && blockSliceTagsFilter.length > 0;
  const filteredRows = useMemo(() => {
    if (hasSliceFilter) {
      // When filter is active, use isHiddenByFilter from the hook
      return rows;
    }
    // When no filter, filter out slice rows that aren't expanded
    return rows.filter((row) => {
      if (!row.isSliceRow) return true; // Always include parent rows
      // For slice rows, check if parent metric is expanded
      if (row.parentRowId) {
        const expandedKey = `${row.parentRowId}:${row.resultGroup}`;
        return !!expandedMetrics?.[expandedKey];
      }
      return true;
    });
  }, [rows, hasSliceFilter, expandedMetrics]);

  const rowGroups = groupBy(filteredRows, ({ resultGroup }) => resultGroup);

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
            setVariationFilter={isEditing ? setVariationFilter : undefined}
            baselineRow={baselineRow}
            setBaselineRow={isEditing ? setBaselineRow : undefined}
            columnsFilter={columnsFilter}
            status={experiment.status}
            isLatestPhase={true}
            startDate={latestPhase?.dateStarted || ""}
            endDate={latestPhase?.dateEnded || ""}
            rows={rows}
            tableRowAxis="metric"
            resultGroup={resultGroup as "goal" | "secondary" | "guardrail"}
            labelHeader={`${resultGroup.charAt(0).toUpperCase() + resultGroup.slice(1)} Metrics`}
            renderLabelColumn={getRenderLabelColumn({
              statsEngine,
              hideDetails: false,
              expandedMetrics,
              toggleExpandedMetric,
              getExperimentMetricById,
              getFactTableById,
              shouldShowMetricSlices: true,
              getChildRowCounts,
              sliceTagsFilter: blockSliceTagsFilter,
            })}
            dateCreated={snapshot.dateCreated}
            statsEngine={statsEngine}
            sequentialTestingEnabled={sequentialTestingEnabled}
            pValueCorrection={pValueCorrection}
            differenceType={differenceType}
            setDifferenceType={isEditing ? setDifferenceType : undefined}
            queryStatusData={queryStatusData}
            isTabActive={isTabActive}
            isGoalMetrics={resultGroup === "goal"}
            ssrPolyfills={ssrPolyfills}
            disableTimeSeriesButton={true}
            sortBy={
              blockSortBy === "metricIds" ? "custom" : (blockSortBy ?? null)
            }
            setSortBy={
              isEditing && setSortBy
                ? (value: "significance" | "change" | "custom" | null) => {
                    setSortBy(value as "significance" | "change" | null);
                  }
                : undefined
            }
            sortDirection={blockSortDirection ?? null}
            setSortDirection={isEditing ? setSortDirection : undefined}
          />
        ),
      )}
    </div>
  );
}
