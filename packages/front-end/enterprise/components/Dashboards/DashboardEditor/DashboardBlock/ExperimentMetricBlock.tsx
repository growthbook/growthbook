import React, { useMemo, useState } from "react";
import { v4 as uuid4 } from "uuid";
import { ExperimentMetricBlockInterface } from "back-end/src/enterprise/validators/dashboard-block";
import { isString } from "shared/util";
import { groupBy } from "lodash";
import { blockHasFieldOfType } from "shared/enterprise";
import { MetricSnapshotSettings } from "back-end/types/report";
import { DEFAULT_PROPER_PRIOR_STDDEV } from "shared/constants";
import { expandMetricGroups, generatePinnedSliceKey } from "shared/experiments";
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
    pinnedMetricSlices,
    pinSource,
  } = block;
  const blockId = useMemo(
    () => (blockHasFieldOfType(block, "id", isString) ? block.id : uuid4()),
    [block],
  );

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

  // Determine which pinned slices to use based on pinSource
  const effectivePinnedMetricSlices = useMemo(() => {
    const source = pinSource || "experiment"; // Default to "experiment" if undefined
    if (source === "experiment") {
      return experiment.pinnedMetricSlices;
    } else if (source === "custom") {
      return pinnedMetricSlices;
    } else {
      // source === "none"
      return undefined;
    }
  }, [pinSource, experiment.pinnedMetricSlices, pinnedMetricSlices]);

  const expandedMetricIds = metrics?.map((m) => m.id) || [];
  const goalMetrics = expandMetricGroups(
    experiment.goalMetrics,
    ssrPolyfills?.metricGroups || metricGroups,
  ).filter((mId) => expandedMetricIds.includes(mId));
  const secondaryMetrics = expandMetricGroups(
    experiment.secondaryMetrics,
    ssrPolyfills?.metricGroups || metricGroups,
  ).filter(
    (mId) => expandedMetricIds.includes(mId) && !goalMetrics.includes(mId),
  );
  const guardrailMetrics = expandMetricGroups(
    experiment.guardrailMetrics,
    ssrPolyfills?.metricGroups || metricGroups,
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
    pinnedMetricSlices: effectivePinnedMetricSlices,
    statsEngine,
    pValueCorrection,
    settingsForSnapshotMetrics,
    shouldShowMetricSlices: true,
    enableExpansion: true,
    enablePinning: true,
    expandedMetrics,
  });

  const rowGroups = groupBy(rows, ({ resultGroup }) => resultGroup);

  // Toggle function for pinning metric slices
  const togglePinnedMetricSlice = (
    metricId: string,
    sliceLevels: Array<{
      dimension: string;
      datatype: "string" | "boolean";
      levels: string[];
    }>,
    resultGroup: "goal" | "secondary" | "guardrail",
  ) => {
    if (!setBlock) return;

    // Convert dimension to column for generatePinnedSliceKey
    const sliceLevelsWithColumn = sliceLevels.map(
      ({ dimension, datatype, levels }) => ({
        column: dimension,
        datatype,
        levels,
      }),
    );

    const pinnedKey = generatePinnedSliceKey(
      metricId,
      sliceLevelsWithColumn,
      resultGroup,
    );
    const currentPinnedSlices = pinnedMetricSlices || [];

    console.log("togglePinnedMetricSlice debug:", {
      metricId,
      sliceLevels,
      resultGroup,
      pinnedKey,
      currentPinnedSlices,
      isPinned: currentPinnedSlices.includes(pinnedKey),
    });

    const isPinned = currentPinnedSlices.includes(pinnedKey);
    const newPinnedSlices = isPinned
      ? currentPinnedSlices.filter((key) => key !== pinnedKey)
      : [...currentPinnedSlices, pinnedKey];

    console.log("togglePinnedMetricSlice update:", {
      isPinned,
      newPinnedSlices,
    });

    setBlock({
      ...block,
      pinnedMetricSlices: newPinnedSlices,
    });
  };

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
