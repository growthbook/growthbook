import React, { useMemo, useCallback, useState } from "react";
import { ExperimentTimeSeriesBlockInterface } from "shared/enterprise";
import { MetricSnapshotSettings } from "shared/types/report";
import {
  DEFAULT_PROPER_PRIOR_STDDEV,
  PRECOMPUTED_DIMENSION_PREFIX,
} from "shared/constants";
import { groupBy } from "lodash";
import { getValidDate } from "shared/dates";
import { getLatestPhaseVariations } from "shared/experiments";
import ExperimentMetricTimeSeriesGraphWrapper from "@/components/Experiment/ExperimentMetricTimeSeriesGraphWrapper";
import useOrgSettings from "@/hooks/useOrgSettings";
import usePValueThreshold from "@/hooks/usePValueThreshold";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useExperimentTableRows } from "@/hooks/useExperimentTableRows";
import { getRenderLabelColumn } from "@/components/Experiment/CompactResults";
import Text from "@/ui/Text";
import { BlockProps } from ".";

export default function ExperimentTimeSeriesBlock({
  block,
  experiment,
  snapshot,
  analysis,
  ssrPolyfills,
}: BlockProps<ExperimentTimeSeriesBlockInterface>) {
  const {
    variationIds,
    metricIds: blockMetricIds,
    sliceTagsFilter: blockSliceTagsFilter,
    metricTagFilter: blockMetricTagFilter,
    sortBy: blockSortBy,
    sortDirection: blockSortDirection,
    dimensionId: blockDimensionId,
    dimensionValues: blockDimensionValues,
  } = block;

  // When a precomputed dimension is selected, the block's analysis is the
  // per-dimension-value analysis (results = one entry per level), so we render
  // one time series per level instead of the single dimensionless series.
  const hasDimension = !!blockDimensionId && blockDimensionId.length > 0;

  const { pValueCorrection: hookPValueCorrection } = useOrgSettings();
  const { getExperimentMetricById, getFactTableById, getDimensionById } =
    useDefinitions();

  // Resolve the dimension's display name. Precomputed experiment dimensions are
  // stored as `precomputed:<name>`; precomputed unit dimensions are stored by id
  // and resolved via the definitions store.
  const dimensionName = useMemo(() => {
    if (!blockDimensionId) return "";
    if (blockDimensionId.startsWith(PRECOMPUTED_DIMENSION_PREFIX)) {
      return blockDimensionId.slice(PRECOMPUTED_DIMENSION_PREFIX.length);
    }
    return getDimensionById(blockDimensionId)?.name ?? blockDimensionId;
  }, [blockDimensionId, getDimensionById]);

  const statsEngine = analysis.settings.statsEngine;
  const pValueCorrection =
    ssrPolyfills?.useOrgSettings()?.pValueCorrection || hookPValueCorrection;

  const _pValueThreshold = usePValueThreshold(experiment.project);
  const pValueThreshold =
    ssrPolyfills?.usePValueThreshold?.(experiment.project) || _pValueThreshold;

  const result = analysis.results[0];

  // Dimension levels to render graphs for: filtered by the block's selected
  // values, or all available levels when none are explicitly selected.
  const dimensionValuesToRender = useMemo(() => {
    if (!hasDimension) return [];
    const allValues = (analysis.results ?? [])
      .map((r) => r.name)
      .filter((name) => name !== "");
    if (blockDimensionValues && blockDimensionValues.length > 0) {
      return allValues.filter((v) => blockDimensionValues.includes(v));
    }
    return allValues;
  }, [hasDimension, analysis.results, blockDimensionValues]);

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
    shouldShowMetricSlices: !hasDimension,
    enableExpansion: !hasDimension,
    expandedMetrics,
    sortBy: blockSortBy,
    sortDirection: blockSortDirection,
    customMetricOrder:
      blockSortBy === "metrics" && blockMetricIds && blockMetricIds.length > 0
        ? blockMetricIds
        : undefined,
    pValueThreshold,
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

  const renderLabelColumn = getRenderLabelColumn({
    expandedMetrics,
    toggleExpandedMetric,
    getExperimentMetricById,
    getFactTableById,
    shouldShowMetricSlices: !hasDimension,
    getChildRowCounts,
    sliceTagsFilter: blockSliceTagsFilter,
  });

  return (
    <>
      {Object.entries(rowGroups).map(([resultGroup, rows]) =>
        !rows.length ? null : (
          <div key={resultGroup} className="mb-4">
            {rows.map((row) => {
              // Only render parent rows (not slice rows) for time series
              if (row.isSliceRow) return null;

              const metric = row.metric;
              if (!metric) return null;

              const appliedPValueCorrection =
                resultGroup === "goal" ? (pValueCorrection ?? null) : null;

              const variations = getLatestPhaseVariations(experiment);
              const showVariations = variations.map(
                (v) => variationIds.length === 0 || variationIds.includes(v.id),
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

              // Shared by the dimensionless and per-dimension-level layouts;
              // only the dimension props differ.
              const renderGraph = (dimensionValue?: string) => (
                <ExperimentMetricTimeSeriesGraphWrapper
                  experimentId={experiment.id}
                  pValueThreshold={pValueThreshold}
                  phase={snapshot.phase}
                  metric={metric}
                  differenceType={
                    analysis?.settings.differenceType || "relative"
                  }
                  showVariations={showVariations}
                  variations={variations}
                  statsEngine={statsEngine}
                  pValueAdjustmentEnabled={!!appliedPValueCorrection}
                  firstDateToRender={phaseStartDate}
                  sliceId={row.sliceId}
                  dimensionId={
                    dimensionValue !== undefined ? blockDimensionId : undefined
                  }
                  dimensionValue={dimensionValue}
                />
              );

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

                    {!row.labelOnly &&
                      (hasDimension
                        ? dimensionValuesToRender.map((dimValue) => (
                            <div
                              key={`${metric.id}-${dimValue}`}
                              className="mb-2"
                            >
                              {/* Match renderLabelColumn's indentation (pl-1 +
                            pl-3 + ml-2) so the dimension text lines up with the
                            fixed metric label column above. */}
                              <div className="pl-1">
                                <div className="pl-3 ml-2">
                                  <Text
                                    as="div"
                                    mb="1"
                                    size="medium"
                                    weight="medium"
                                  >
                                    Dimension:{" "}
                                    <Text size="medium" weight="regular">
                                      {dimensionName}={dimValue}
                                    </Text>
                                  </Text>
                                </div>
                              </div>
                              {renderGraph(dimValue)}
                            </div>
                          ))
                        : renderGraph())}
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
                            pValueThreshold={pValueThreshold}
                            phase={snapshot.phase}
                            metric={sliceRow.metric}
                            differenceType={
                              analysis?.settings.differenceType || "relative"
                            }
                            showVariations={showVariations}
                            variations={variations}
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
