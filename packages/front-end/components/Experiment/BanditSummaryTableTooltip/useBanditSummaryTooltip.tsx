import { useState, useEffect } from "react";
import { useTooltip, useTooltipInPortal } from "@visx/tooltip";
import { BanditEvent } from "shared/src/validators/experiments";
import { ExperimentMetricInterface } from "shared/experiments";
import { WIN_THRESHOLD_PROBABILITY } from "@/components/Experiment/BanditSummaryTable";
import {
  LayoutX,
  TOOLTIP_HEIGHT,
  TOOLTIP_TIMEOUT,
  TOOLTIP_WIDTH,
  TooltipData,
  TooltipHoverSettings,
  YAlign,
} from "./BanditSummaryTooltip";

export function useBanditSummaryTooltip({
  metric,
  variations,
  currentEvent,
  probabilities,
  regressionAdjustmentEnabled,
}: {
  metric: ExperimentMetricInterface | null;
  variations: { id: string; index: number; name: string }[];
  currentEvent: BanditEvent;
  probabilities: number[];
  regressionAdjustmentEnabled?: boolean;
}) {
  const { showTooltip, hideTooltip, tooltipOpen, tooltipData } =
    useTooltip<TooltipData>();

  const { containerRef, containerBounds } = useTooltipInPortal({
    scroll: true,
    detectBounds: false,
  });

  const [hoveredVariationRow, setHoveredVariationRow] = useState<number | null>(
    null,
  );
  const [hoveredX, setHoveredX] = useState<number | null>(null);
  const [hoveredY, setHoveredY] = useState<number | null>(null);
  const [hoverTimeout, setHoverTimeout] = useState<number | null>(null);

  const clearHover = () => {
    hideTooltip();
    setHoveredX(null);
    setHoveredY(null);
    setHoveredVariationRow(null);
  };

  const resetTimeout = () => {
    if (hoverTimeout) clearTimeout(hoverTimeout);
  };

  const hoverRow = (
    variationRow: number,
    event: React.PointerEvent<HTMLElement>,
    settings?: TooltipHoverSettings,
  ) => {
    if (hoveredVariationRow !== null && hoveredVariationRow !== variationRow) {
      closeTooltip();
      return;
    }

    resetTimeout();
    if (hoveredVariationRow !== null && hoveredVariationRow === variationRow) {
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
      setHoveredX(targetLeft - containerBounds.left);
      setHoveredY(targetTop - containerBounds.top);
    }

    if (!metric) return;

    const variation = variations?.[variationRow];
    if (!variation) return;

    const probability = probabilities?.[variationRow];

    const status = (probability ?? 0) >= WIN_THRESHOLD_PROBABILITY ? "won" : "";

    const results = currentEvent?.banditResult?.singleVariationResults;
    const result:
      | { users?: number; cr?: number; ci?: [number, number] }
      | undefined = results?.[variationRow];
    if (!result) return;

    const stats = {
      value: (result?.cr ?? 0) * (result?.users ?? 0),
      ci: result?.ci ?? [0, 0],
      cr: result?.cr ?? NaN,
      users: result?.users ?? 0,
    };

    showTooltip({
      tooltipData: {
        variation,
        probability,
        stats,
        status,
        currentEvent,
        metric,
        layoutX,
        yAlign,
        regressionAdjustmentEnabled,
      } as TooltipData,
    });
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
    hoveredVariationRow,
    resetTimeout,
  };
}
