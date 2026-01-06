import React, { useMemo, useCallback, useState } from "react";
import { v4 as uuid4 } from "uuid";
import {
  ExperimentMetricBlockInterface,
  blockHasFieldOfType,
  filterAndGroupExperimentMetrics,
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
import { BlockProps } from ".";

export default function ExperimentMetricBlock({
  isTabActive,
  block,
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
    metricIds: blockMetricIds,
    sliceTagsFilter: blockSliceTagsFilter,
    metricTagFilter: blockMetricTagFilter,
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

  const [expandedMetrics, setExpandedMetrics] = useState<
    Record<string, boolean>
  >({});
  const toggleExpandedMetric = useCallback(
    (metricId: string, resultGroup: "goal" | "secondary" | "guardrail") => {
      const key = `${metricId}:${resultGroup}`;
      setExpandedMetrics((prev) => ({
        ...prev,
        [key]: !prev[key],
      }));
    },
    [],
  );

  const metricIds = metrics?.map((m) => m.id) || [];
  const allowDuplicates = block.metricSelector === "all";
  const { goalMetrics, secondaryMetrics, guardrailMetrics } =
    filterAndGroupExperimentMetrics({
      goalMetrics: experiment.goalMetrics,
      secondaryMetrics: experiment.secondaryMetrics,
      guardrailMetrics: experiment.guardrailMetrics,
      metricGroups: ssrPolyfills?.metricGroups || metricGroups,
      selectedMetricIds: metricIds,
      allowDuplicates,
    });

  const { rows, getChildRowCounts } = useExperimentTableRows({
    results: result,
    goalMetrics,
    secondaryMetrics,
    guardrailMetrics,
    metricOverrides: experiment.metricOverrides ?? [],
    ssrPolyfills,
    customMetricSlices: experiment.customMetricSlices,
    pinnedMetricSlices: undefined,
    metricTagFilter: blockMetricTagFilter,
    sliceTagsFilter: blockSliceTagsFilter,
    statsEngine,
    pValueCorrection,
    settingsForSnapshotMetrics,
    shouldShowMetricSlices: true,
    enableExpansion: true,
    enablePinning: false,
    expandedMetrics,
    sortBy: blockMetricIds && blockMetricIds.length > 0 ? "custom" : null,
    customMetricOrder:
      blockMetricIds && blockMetricIds.length > 0 ? blockMetricIds : undefined,
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
              statsEngine,
              hideDetails: false,
              experimentType: undefined,
              pinnedMetricSlices: undefined,
              togglePinnedMetricSlice: undefined,
              expandedMetrics,
              toggleExpandedMetric: isEditing
                ? toggleExpandedMetric
                : undefined,
              getExperimentMetricById,
              getFactTableById,
              shouldShowMetricSlices: true,
              getChildRowCounts,
              pinSource: undefined,
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
            disableTimeSeriesButton={true}
          />
        ),
      )}
    </div>
  );
}
