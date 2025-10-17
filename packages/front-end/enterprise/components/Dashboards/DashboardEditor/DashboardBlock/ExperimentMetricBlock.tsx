import React, { useMemo, useState } from "react";
import { v4 as uuid4 } from "uuid";
import { ExperimentMetricBlockInterface } from "back-end/src/enterprise/validators/dashboard-block";
import { isString } from "shared/util";
import { groupBy } from "lodash";
import { blockHasFieldOfType } from "shared/enterprise";
import { MetricSnapshotSettings } from "back-end/types/report";
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
  metrics: _metrics,
}: BlockProps<ExperimentMetricBlockInterface>) {
  const { baselineRow, columnsFilter, variationIds, pinnedMetricSlices } =
    block;
  const blockId = useMemo(
    () => (blockHasFieldOfType(block, "id", isString) ? block.id : uuid4()),
    [block],
  );

  const { pValueCorrection: hookPValueCorrection } = useOrgSettings();
  const {
    metricGroups: _metricGroups,
    getExperimentMetricById,
    getFactTableById,
  } = useDefinitions();

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

  // Manage expansion state externally
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

  const { rows } = useExperimentTableRows({
    results: result,
    goalMetrics: experiment.goalMetrics,
    secondaryMetrics: experiment.secondaryMetrics,
    guardrailMetrics: experiment.guardrailMetrics,
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
    toggleExpandedMetric,
  });

  const rowGroups = groupBy(rows, ({ resultGroup }) => resultGroup);

  const getChildRowCounts = (metricId: string) => {
    const childRows = rows.filter((row) => row.parentRowId === metricId);
    const pinnedChildRows = childRows.filter((row) => !!row.isPinned);
    return {
      total: childRows.length,
      pinned: pinnedChildRows.length,
    };
  };

  return (
    <div>
      {Object.entries(rowGroups).map(([resultGroup, rows]) => (
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
          labelHeader={`${
            resultGroup.charAt(0).toUpperCase() + resultGroup.slice(1)
          } Metrics`}
          renderLabelColumn={getRenderLabelColumn({
            statsEngine,
            hideDetails: false,
            experimentType: undefined,
            pinnedMetricSlices,
            togglePinnedMetricSlice: undefined, // No pinning toggle in dashboard blocks for now
            expandedMetrics,
            toggleExpandedMetric,
            getExperimentMetricById,
            getFactTableById,
            shouldShowMetricSlices: true,
            getChildRowCounts,
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
      ))}
    </div>
  );
}
