import { useState, useEffect, useRef } from "react";
import { ExperimentReportVariationWithIndex } from "back-end/types/report";
import {
  StatsEngine,
  PValueCorrection,
  DifferenceType,
} from "back-end/types/stats";
import { ExperimentTableRow, RowResults } from "@/services/experiments";
import { SnapshotMetric } from "back-end/types/experiment-snapshot";
import { ExperimentMetricInterface } from "shared/experiments";
import { MetricSnapshotSettings } from "back-end/types/report";

// Types from the original ResultsTableTooltip
type LayoutX = "element-center" | "element-left" | "element-right";
type YAlign = "top" | "bottom";

export interface TooltipData {
  metricRow: number;
  metric: ExperimentMetricInterface;
  metricSnapshotSettings?: MetricSnapshotSettings;
  dimensionName?: string;
  dimensionValue?: string;
  variation: ExperimentReportVariationWithIndex;
  stats: SnapshotMetric;
  baseline: SnapshotMetric;
  baselineVariation: ExperimentReportVariationWithIndex;
  rowResults: RowResults;
  statsEngine: StatsEngine;
  pValueCorrection?: PValueCorrection;
  isGuardrail: boolean;
  layoutX: LayoutX;
  yAlign: YAlign;
}

interface TooltipHoverSettings {
  x: LayoutX;
  offsetX?: number;
  offsetY?: number;
  targetClassName?: string;
}

const TOOLTIP_TIMEOUT = 250; // Mouse-out delay before closing
const TOOLTIP_WIDTH = 400;
const TOOLTIP_HEIGHT = 400;

export function useResultsTableTooltip({
  orderedVariations,
  rows,
  rowsResults,
  dimension,
  statsEngine,
  differenceType,
  pValueCorrection,
  noTooltip,
}: {
  orderedVariations: ExperimentReportVariationWithIndex[];
  rows: ExperimentTableRow[];
  rowsResults: (RowResults | "query error" | null)[][];
  dimension?: string;
  statsEngine: StatsEngine;
  differenceType: DifferenceType;
  pValueCorrection?: PValueCorrection;
  noTooltip?: boolean;
}) {
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const [tooltipData, setTooltipData] = useState<TooltipData | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const targetElementRef = useRef<HTMLElement | null>(null);

  const [hoveredMetricRow, setHoveredMetricRow] = useState<number | null>(null);
  const [hoveredVariationRow, setHoveredVariationRow] = useState<number | null>(
    null
  );
  const [hoveredX, setHoveredX] = useState<number | null>(null);
  const [hoveredY, setHoveredY] = useState<number | null>(null);
  const [hoverTimeout, setHoverTimeout] = useState<number | null>(null);

  const clearHover = () => {
    setTooltipOpen(false);
    setTooltipData(null);
    setHoveredX(null);
    setHoveredY(null);
    setHoveredMetricRow(null);
    setHoveredVariationRow(null);
    targetElementRef.current = null;
  };

  const resetTimeout = () => {
    if (hoverTimeout) clearTimeout(hoverTimeout);
  };

  const hoverRow = (
    metricRow: number,
    variationRow: number,
    event: React.PointerEvent<HTMLElement>,
    settings?: TooltipHoverSettings
  ) => {
    if (noTooltip) return;
    if (
      hoveredMetricRow !== null &&
      hoveredVariationRow !== null &&
      (hoveredMetricRow !== metricRow || hoveredVariationRow !== variationRow)
    ) {
      closeTooltip();
      return;
    }

    resetTimeout();
    if (
      hoveredMetricRow !== null &&
      hoveredVariationRow !== null &&
      hoveredMetricRow === metricRow &&
      hoveredVariationRow === variationRow
    ) {
      // don't recompute tooltip if we're already hovering over the same row
      return;
    }

    const layoutX: LayoutX = settings?.x ?? "element-right";
    const offsetX = settings?.offsetX ?? 0;
    const offsetY = settings?.offsetY ?? 3;
    const el = event.target as HTMLElement;
    const target = settings?.targetClassName
      ? (el.classList.contains(settings.targetClassName)
          ? el
          : el.closest(`.${settings.targetClassName}`)) ?? el
      : (el.tagName === "td" ? el : el.closest("td")) ?? el;

    // Calculate tooltip position
    let targetTop: number =
      (target.getBoundingClientRect()?.bottom ?? 0) - offsetY;
    if (targetTop > TOOLTIP_HEIGHT + 80) {
      targetTop =
        (target.getBoundingClientRect()?.top ?? 0) - TOOLTIP_HEIGHT + offsetY;
    }

    let targetLeft: number =
      (layoutX === "element-left"
        ? (target.getBoundingClientRect()?.left ?? 0) - TOOLTIP_WIDTH + 25
        : layoutX === "element-right"
        ? (target.getBoundingClientRect()?.right ?? 0) - 25
        : layoutX === "element-center"
        ? ((target.getBoundingClientRect()?.left ?? 0) +
            (target.getBoundingClientRect()?.right ?? 0)) /
            2 -
          TOOLTIP_WIDTH / 2
        : event.clientX + 10) + offsetX;

    // Prevent tooltip from going off the screen (x-axis)
    if (targetLeft < 10) {
      targetLeft = 10;
    }
    if (
      targetLeft + Math.min(TOOLTIP_WIDTH, window.innerWidth) >
      window.innerWidth - 10
    ) {
      targetLeft =
        window.innerWidth - Math.min(TOOLTIP_WIDTH, window.innerWidth) - 10;
    }

    if (hoveredX === null && hoveredY === null) {
      // For the new popover, we'll use the target element directly
      // and let the popover handle its own positioning
      setHoveredX(targetLeft);
      setHoveredY(targetTop);
    }

    // Set tooltip data and show popover
    const row = rows[metricRow];
    const baseline = row.variations[orderedVariations[0].index] || {
      value: 0,
      cr: 0,
      users: 0,
    };
    const stats = row.variations[orderedVariations[variationRow].index] || {
      value: 0,
      cr: 0,
      users: 0,
    };
    const metric = row.metric;
    const variation = orderedVariations[variationRow];
    const baselineVariation = orderedVariations[0];
    const rowResults = rowsResults[metricRow][variationRow];
    
    if (!rowResults) return;
    if (rowResults === "query error") return;
    if (!rowResults.hasScaledImpact && differenceType === "scaled") return;

    // Set the target element for positioning - ensure it's an HTMLElement
    const targetElement = target instanceof HTMLElement ? target : null;
    if (targetElement) {
      targetElementRef.current = targetElement;
    }
    
    // Update tooltip data and open state
    setTooltipData({
      metricRow,
      metric,
      metricSnapshotSettings: row.metricSnapshotSettings,
      dimensionName: dimension,
      dimensionValue: dimension ? row.label : undefined,
      variation,
      stats,
      baseline,
      baselineVariation,
      rowResults,
      statsEngine,
      pValueCorrection,
      isGuardrail: row.resultGroup === "guardrail",
      layoutX,
      yAlign: 'top',
    });
    
    setTooltipOpen(true);
    setHoveredMetricRow(metricRow);
    setHoveredVariationRow(variationRow);
  };

  const leaveRow = () => {
    const timeout = window.setTimeout(clearHover, TOOLTIP_TIMEOUT);
    setHoverTimeout(timeout);
  };

  const closeTooltip = () => {
    resetTimeout();
    clearHover();
  };

  useEffect(() => {
    return () => {
      if (hoverTimeout) clearTimeout(hoverTimeout);
    };
  }, [hoverTimeout]);

  return {
    containerRef,
    tooltipOpen,
    tooltipData: tooltipData as TooltipData,
    hoveredX,
    hoveredY,
    hoverRow,
    leaveRow,
    closeTooltip,
    hoveredMetricRow,
    hoveredVariationRow,
    resetTimeout,
    targetElement: targetElementRef.current,
  };
}
