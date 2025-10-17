import React, { useState } from "react";
import { ExperimentTimeSeriesBlockInterface } from "back-end/src/enterprise/validators/dashboard-block";
import { expandMetricGroups } from "shared/experiments";
import { MetricSnapshotSettings } from "back-end/types/report";
import { DEFAULT_PROPER_PRIOR_STDDEV } from "shared/constants";
import { groupBy } from "lodash";
import { getValidDate } from "shared/dates";
import ExperimentMetricTimeSeriesGraphWrapper from "@/components/Experiment/ExperimentMetricTimeSeriesGraphWrapper";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useDefinitions } from "@/services/DefinitionsContext";
import { getMetricResultGroup as _getMetricResultGroup } from "@/hooks/useExperimentDimensionRows";
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
  const { variationIds, pinnedMetricSlices } = block;

  const { pValueCorrection: hookPValueCorrection } = useOrgSettings();
  const {
    metricGroups: _metricGroups,
    getExperimentMetricById,
    getFactTableById,
  } = useDefinitions();

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
  const toggleExpandedMetric = (
    metricId: string,
    resultGroup: "goal" | "secondary" | "guardrail",
  ) => {
    const key = `${metricId}:${resultGroup}`;
    setExpandedMetrics((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const expandedMetricIds = metrics?.map((m) => m.id) || [];
  const goalMetrics = expandMetricGroups(
    experiment.goalMetrics,
    ssrPolyfills?.metricGroups || _metricGroups,
  ).filter((mId) => expandedMetricIds.includes(mId));
  const secondaryMetrics = expandMetricGroups(
    experiment.secondaryMetrics,
    ssrPolyfills?.metricGroups || _metricGroups,
  ).filter(
    (mId) => expandedMetricIds.includes(mId) && !goalMetrics.includes(mId),
  );
  const guardrailMetrics = expandMetricGroups(
    experiment.guardrailMetrics,
    ssrPolyfills?.metricGroups || _metricGroups,
  ).filter(
    (mId) =>
      expandedMetricIds.includes(mId) &&
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
    pinnedMetricSlices,
    statsEngine,
    pValueCorrection,
    settingsForSnapshotMetrics,
    shouldShowMetricSlices: true,
    enableExpansion: true,
    enablePinning: true,
    expandedMetrics,
  });

  const rowGroups = groupBy(rows, ({ resultGroup }) => resultGroup);

  // Create the render label function
  const renderLabelColumn = getRenderLabelColumn({
    statsEngine,
    hideDetails: false,
    experimentType: undefined,
    pinnedMetricSlices,
    togglePinnedMetricSlice: undefined, // No pinning toggle in dashboard blocks for now
    expandedMetrics,
    toggleExpandedMetric: isEditing ? toggleExpandedMetric : undefined,
    getExperimentMetricById,
    getFactTableById,
    shouldShowMetricSlices: true,
    getChildRowCounts,
  });

  return (
    <>
      {Object.entries(rowGroups).map(([resultGroup, rows]) =>
        !rows.length ? null : (
          <div key={resultGroup} className="mb-4">
            <h4 className="mb-3">
              {resultGroup.charAt(0).toUpperCase() + resultGroup.slice(1)}{" "}
              Metrics
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
              const childRows = rows.filter((r) => r.parentRowId === metric.id);
              const hasSlices = childRows.length > 0;

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

                    {/* Parent metric time series */}
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
                  </div>

                  {/* Slice time series (if expanded) */}
                  {isExpanded && hasSlices && (
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
                            {/* Slice label with proper formatting */}
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
                              pValueAdjustmentEnabled={
                                !!appliedPValueCorrection
                              }
                              firstDateToRender={phaseStartDate}
                              sliceId={sliceRow.sliceId}
                            />
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ),
      )}
    </>
  );
}
