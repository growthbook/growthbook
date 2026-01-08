import React, { useMemo, useCallback, useState } from "react";
import {
  ExperimentTimeSeriesBlockInterface,
  filterAndGroupExperimentMetrics,
} from "shared/enterprise";
import { MetricSnapshotSettings } from "shared/types/report";
import { DEFAULT_PROPER_PRIOR_STDDEV } from "shared/constants";
import { groupBy } from "lodash";
import { getValidDate } from "shared/dates";
import ExperimentMetricTimeSeriesGraphWrapper from "@/components/Experiment/ExperimentMetricTimeSeriesGraphWrapper";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useExperimentTableRows } from "@/hooks/useExperimentTableRows";
import { getRenderLabelColumn } from "@/components/Experiment/CompactResults";
import { BlockProps } from ".";

export default function ExperimentTimeSeriesBlock({
  block,
  experiment,
  snapshot,
  analysis,
  ssrPolyfills,
  isEditing,
  metrics,
}: BlockProps<ExperimentTimeSeriesBlockInterface>) {
  const {
    variationIds,
    metricIds: blockMetricIds,
    sliceTagsFilter: blockSliceTagsFilter,
    metricTagFilter: blockMetricTagFilter,
    sortBy: blockSortBy,
    sortDirection: blockSortDirection,
  } = block;

  const { pValueCorrection: hookPValueCorrection } = useOrgSettings();
  const { metricGroups, getExperimentMetricById, getFactTableById } =
    useDefinitions();

  const statsEngine = analysis.settings.statsEngine;
  const pValueCorrection =
    ssrPolyfills?.useOrgSettings()?.pValueCorrection || hookPValueCorrection;

  const result = analysis.results[0];

  const currentPhase = experiment.phases[snapshot.phase];
  const phaseStartDate = currentPhase?.dateStarted
    ? getValidDate(currentPhase.dateStarted)
    : new Date();

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
    metricTagFilter: blockMetricTagFilter,
    sliceTagsFilter: blockSliceTagsFilter,
    statsEngine,
    pValueCorrection,
    settingsForSnapshotMetrics,
    shouldShowMetricSlices: true,
    enableExpansion: true,
    expandedMetrics,
    sortBy: blockSortBy === "metricIds" ? "custom" : blockSortBy,
    sortDirection: blockSortBy !== "metricIds" ? blockSortDirection : undefined,
    customMetricOrder:
      blockSortBy === "metricIds" && blockMetricIds && blockMetricIds.length > 0
        ? blockMetricIds
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

  // Create the render label function
  const renderLabelColumn = getRenderLabelColumn({
    statsEngine,
    hideDetails: false,
    expandedMetrics,
    toggleExpandedMetric: isEditing ? toggleExpandedMetric : undefined,
    getExperimentMetricById,
    getFactTableById,
    shouldShowMetricSlices: true,
    getChildRowCounts,
    sliceTagsFilter: blockSliceTagsFilter,
  });

  const selectorLabel =
    block.metricSelector !== "all"
      ? {
          "experiment-goal": "Goal Metrics",
          "experiment-secondary": "Secondary Metrics",
          "experiment-guardrail": "Guardrail Metrics",
        }[block.metricSelector]
      : null;

  return (
    <>
      {Object.entries(rowGroups).map(([resultGroup, rows]) =>
        !rows.length ? null : (
          <div key={resultGroup} className="mb-4">
            <h4 className="mb-3">
              {selectorLabel ||
                `${resultGroup.charAt(0).toUpperCase() + resultGroup.slice(1)} Metrics`}
            </h4>
            {rows.map((row) => {
              // Only render parent rows (not slice rows) for time series
              if (row.isSliceRow) return null;

              const metric = row.metric;
              if (!metric) return null;

              const appliedPValueCorrection =
                resultGroup === "goal" ? (pValueCorrection ?? null) : null;

              const showVariations = experiment.variations.map(
                (v) => variationIds.length === 0 || variationIds.includes(v.id),
              );
              const variationNames = experiment.variations.map(
                ({ name }) => name,
              );

              // Check if this metric has slices and if it's expanded
              const expandedKey = `${metric.id}:${resultGroup}`;
              const isExpanded = !!expandedMetrics[expandedKey];

              // Filter child rows based on expansion state or isHiddenByFilter
              const childRows = filteredRows
                .filter((r) => r.parentRowId === metric.id)
                .filter((sliceRow) => {
                  if (!sliceRow.isSliceRow) return false;
                  if (hasSliceFilter) {
                    return !sliceRow.isHiddenByFilter;
                  }
                  return isExpanded;
                });

              return (
                <div key={metric.id} className="mb-2">
                  <div className="py-2">
                    <div
                      className="d-flex align-items-center position-relative pl-1"
                      style={{ height: 40 }}
                    >
                      {renderLabelColumn({
                        label: row.label,
                        metric: row.metric,
                        row,
                        location: resultGroup as
                          | "goal"
                          | "secondary"
                          | "guardrail",
                      })}
                    </div>

                    {!row.labelOnly && (
                      <ExperimentMetricTimeSeriesGraphWrapper
                        key={metric.id}
                        experimentId={experiment.id}
                        phase={snapshot.phase}
                        experimentStatus={experiment.status}
                        metric={metric}
                        differenceType={
                          analysis?.settings.differenceType || "relative"
                        }
                        showVariations={showVariations}
                        variationNames={variationNames}
                        statsEngine={statsEngine}
                        pValueAdjustmentEnabled={!!appliedPValueCorrection}
                        firstDateToRender={phaseStartDate}
                        sliceId={row.sliceId}
                      />
                    )}
                  </div>

                  <div>
                    {childRows.map((sliceRow) => {
                      if (!sliceRow.metric || !sliceRow.sliceLevels)
                        return null;

                      return (
                        <div
                          key={`${metric.id}-${sliceRow.label}`}
                          className="py-2"
                          style={{
                            backgroundColor: "var(--slate-a2)",
                            borderTop: "1px solid rgba(102, 102, 102, 0.1)",
                          }}
                        >
                          <div
                            className="d-flex align-items-center position-relative pl-1"
                            style={{ height: 40 }}
                          >
                            {renderLabelColumn({
                              label: sliceRow.label,
                              metric: sliceRow.metric,
                              row: sliceRow,
                              location: resultGroup as
                                | "goal"
                                | "secondary"
                                | "guardrail",
                            })}
                          </div>
                          <ExperimentMetricTimeSeriesGraphWrapper
                            experimentId={experiment.id}
                            phase={snapshot.phase}
                            experimentStatus={experiment.status}
                            metric={sliceRow.metric}
                            differenceType={
                              analysis?.settings.differenceType || "relative"
                            }
                            showVariations={showVariations}
                            variationNames={variationNames}
                            statsEngine={statsEngine}
                            pValueAdjustmentEnabled={!!appliedPValueCorrection}
                            firstDateToRender={phaseStartDate}
                            sliceId={sliceRow.sliceId}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        ),
      )}
    </>
  );
}
