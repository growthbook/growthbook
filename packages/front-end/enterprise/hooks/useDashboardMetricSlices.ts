import React, { useState, useMemo, useCallback } from "react";
import {
  DashboardBlockInterface,
  DashboardBlockInterfaceOrData,
} from "back-end/src/enterprise/validators/dashboard-block";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { generatePinnedSliceKey, SliceLevelsData } from "shared/experiments";
import { ExperimentTableRow } from "@/services/experiments";

export function useDashboardPinnedMetricSlices<
  B extends Extract<
    DashboardBlockInterfaceOrData<DashboardBlockInterface>,
    { pinSource: string; pinnedMetricSlices: string[] }
  >,
>(block: B, experiment: ExperimentInterfaceStringDates) {
  const { pinnedMetricSlices, pinSource } = block;
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

  return {
    expandedMetrics,
    toggleExpandedMetric,
    effectivePinnedMetricSlices,
  };
}

export function useDashboardMetricSliceData<
  B extends Extract<
    DashboardBlockInterfaceOrData<DashboardBlockInterface>,
    { pinSource: string; pinnedMetricSlices: string[] }
  >,
>(
  block: B,
  setBlock: React.Dispatch<B> | undefined,
  rows: ExperimentTableRow[],
) {
  const { pinnedMetricSlices } = block;

  const sliceData = useMemo(() => {
    return rows
      .filter((row) => row.isSliceRow && row.sliceId)
      .map((row) => ({
        value: generatePinnedSliceKey(
          row.metric.id,
          row.sliceLevels || [],
          row.resultGroup,
        ),
        label: typeof row.label === "string" ? row.label : row.metric.name,
        sliceLevels: row.sliceLevels || [],
      }));
  }, [rows]);

  const togglePinnedMetricSlice = useCallback(
    (
      metricId: string,
      sliceLevels: SliceLevelsData[],
      resultGroup: "goal" | "secondary" | "guardrail",
    ) => {
      if (!setBlock) return;

      const pinnedKey = generatePinnedSliceKey(
        metricId,
        sliceLevels,
        resultGroup,
      );
      const currentPinnedSlices = pinnedMetricSlices || [];
      const isPinned = currentPinnedSlices.includes(pinnedKey);
      const newPinnedSlices = isPinned
        ? currentPinnedSlices.filter((key) => key !== pinnedKey)
        : [...currentPinnedSlices, pinnedKey];

      setBlock({
        ...block,
        pinnedMetricSlices: newPinnedSlices,
      });
    },
    [setBlock, block, pinnedMetricSlices],
  );

  const isSlicePinned = useCallback(
    (pinKey: string) => {
      const currentPinnedSlices = pinnedMetricSlices || [];
      return currentPinnedSlices.includes(pinKey);
    },
    [pinnedMetricSlices],
  );
  return {
    sliceData,
    togglePinnedMetricSlice,
    isSlicePinned,
  };
}
