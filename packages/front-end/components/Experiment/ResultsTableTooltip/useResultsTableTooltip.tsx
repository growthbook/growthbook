import { useState, useEffect } from "react";
import { useTooltip, useTooltipInPortal } from "@visx/tooltip";
import { ExperimentReportVariationWithIndex } from "shared/types/report";
import {
  StatsEngine,
  PValueCorrection,
  DifferenceType,
} from "shared/types/stats";
import { ExperimentTableRow, RowResults } from "@/services/experiments";
import { RowError } from "@/components/Experiment/ResultsTable";
import {
  LayoutX,
  TOOLTIP_HEIGHT,
  TOOLTIP_TIMEOUT,
  TOOLTIP_WIDTH,
  TooltipData,
  TooltipHoverSettings,
  YAlign,
} from "./ResultsTableTooltip";

export function useResultsTableTooltip({
  orderedVariations,
  rows,
  rowsResults,
  dimension: _dimension,
  statsEngine,
  differenceType,
  pValueCorrection,
  noTooltip,
}: {
  orderedVariations: ExperimentReportVariationWithIndex[];
  rows: ExperimentTableRow[];
  rowsResults: (RowResults | "query error" | RowError | null)[][];
  dimension?: string;
  statsEngine: StatsEngine;
  differenceType: DifferenceType;
  pValueCorrection?: PValueCorrection;
  noTooltip?: boolean;
}) {
  const { showTooltip, hideTooltip, tooltipOpen, tooltipData } =
    useTooltip<TooltipData>();

  const { containerRef, TooltipInPortal } = useTooltipInPortal({
    scroll: true,
    detectBounds: false,
  });

  const [hoveredMetricRow, setHoveredMetricRow] = useState<number | null>(null);
  const [hoveredVariationRow, setHoveredVariationRow] = useState<number | null>(
    null,
  );
  const [hoveredX, setHoveredX] = useState<number | null>(null);
  const [hoveredY, setHoveredY] = useState<number | null>(null);
  const [hoveredXViewport, setHoveredXViewport] = useState<number | null>(null);
  const [hoveredYViewport, setHoveredYViewport] = useState<number | null>(null);
  const [hoverTimeout, setHoverTimeout] = useState<number | null>(null);

  const clearHover = () => {
    hideTooltip();
    setHoveredX(null);
    setHoveredY(null);
    setHoveredXViewport(null);
    setHoveredYViewport(null);
    setHoveredMetricRow(null);
    setHoveredVariationRow(null);
  };

  const resetTimeout = () => {
    if (hoverTimeout) clearTimeout(hoverTimeout);
  };

  const hoverRow = (
    metricRow: number,
    variationRow: number,
    event: React.PointerEvent<HTMLElement>,
    settings?: TooltipHoverSettings,
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
      ? ((el.classList.contains(settings.targetClassName)
          ? el
          : el.closest(`.${settings.targetClassName}`)) ?? el)
      : ((el.tagName === "td" ? el : el.closest("td")) ?? el);

    let yAlign: YAlign = "top";
    let targetTop: number =
      (target.getBoundingClientRect()?.bottom ?? 0) - offsetY;
    if (targetTop > TOOLTIP_HEIGHT + 80) {
      targetTop =
        (target.getBoundingClientRect()?.top ?? 0) - TOOLTIP_HEIGHT + offsetY;
      yAlign = "bottom";
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
      setHoveredX(targetLeft);
      setHoveredY(targetTop);
    }

    // Show tooltip logic
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
    if (rowResults === RowError.QUANTILE_AGGREGATION_ERROR) return;
    if (!rowResults.hasScaledImpact && differenceType === "scaled") return;

    showTooltip({
      tooltipData: {
        metricRow,
        metric,
        metricSnapshotSettings: row.metricSnapshotSettings,
        dimensionName: _dimension,
        dimensionValue: _dimension ? row.label : undefined,
        sliceLevels: row.sliceLevels,
        variation,
        stats,
        baseline,
        baselineVariation,
        rowResults,
        statsEngine,
        pValueCorrection,
        isGuardrail: row.resultGroup === "guardrail",
        layoutX,
        yAlign,
      } as TooltipData,
    });
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
    hoveredXViewport,
    hoveredYViewport,
    hoverRow,
    leaveRow,
    closeTooltip,
    hoveredMetricRow,
    hoveredVariationRow,
    resetTimeout,
    TooltipInPortal,
  };
}
