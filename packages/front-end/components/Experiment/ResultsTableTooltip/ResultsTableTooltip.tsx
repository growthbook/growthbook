import React, { DetailedHTMLProps, HTMLAttributes, useEffect } from "react";
import {
  ExperimentReportVariationWithIndex,
  MetricSnapshotSettings,
} from "back-end/types/report";
import { SnapshotMetric } from "back-end/types/experiment-snapshot";
import {
  DifferenceType,
  PValueCorrection,
  StatsEngine,
} from "back-end/types/stats";
import { BsX } from "react-icons/bs";
import clsx from "clsx";
import { ExperimentMetricInterface } from "shared/experiments";
import { RowResults } from "@/services/experiments";
import { SSRPolyfills } from "@/hooks/useSSRPolyfills";
import AnalysisResultPopover from "@/components/AnalysisResultPopover/AnalysisResultPopover";

export const TOOLTIP_WIDTH = 400;
export const TOOLTIP_HEIGHT = 400; // Used for over/under layout calculation. Actual height may vary.
export const TOOLTIP_TIMEOUT = 250; // Mouse-out delay before closing
export type TooltipHoverSettings = {
  x: LayoutX;
  offsetX?: number;
  offsetY?: number;
  targetClassName?: string;
};
export type LayoutX = "element-center" | "element-left" | "element-right";
export type YAlign = "top" | "bottom";

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

interface Props
  extends DetailedHTMLProps<HTMLAttributes<HTMLDivElement>, HTMLDivElement> {
  left: number;
  top: number;
  data?: TooltipData;
  tooltipOpen: boolean;
  close: () => void;
  differenceType: DifferenceType;
  isBandit?: boolean;
  ssrPolyfills?: SSRPolyfills;
}
export default function ResultsTableTooltip({
  left,
  top,
  data,
  tooltipOpen,
  close,
  differenceType,
  isBandit,
  ssrPolyfills,
  ...otherProps
}: Props) {
  useEffect(() => {
    if (!data || !tooltipOpen) return;

    const callback = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target?.closest(".experiment-row-tooltip")) return;
      close();
    };

    // let the tooltip animate open before allowing a close
    const timeout = setTimeout(() => {
      document.addEventListener("click", callback);
    }, 200);
    return () => {
      clearTimeout(timeout);
      document.removeEventListener("click", callback);
    };
  }, [data, tooltipOpen, close]);

  if (!data) {
    return null;
  }

  const arrowLeft =
    data.layoutX === "element-right"
      ? "3%"
      : data.layoutX === "element-left"
        ? "97%"
        : data.layoutX === "element-center"
          ? "50%"
          : "50%";

  return (
    <div
      className="experiment-row-tooltip-wrapper"
      style={{
        position: "absolute",
        width: Math.min(TOOLTIP_WIDTH, window.innerWidth - 20),
        height: TOOLTIP_HEIGHT,
        left,
        top,
      }}
    >
      <div
        className={clsx("experiment-row-tooltip", {
          top: data.yAlign === "top",
          bottom: data.yAlign === "bottom",
        })}
        style={{
          position: "absolute",
          width: Math.min(TOOLTIP_WIDTH, window.innerWidth - 20),
          top: data.yAlign === "top" ? 0 : "auto",
          bottom: data.yAlign === "bottom" ? 0 : "auto",
          transformOrigin: `${arrowLeft} ${
            data.yAlign === "top" ? "0%" : "100%"
          }`,
        }}
        {...otherProps}
      >
        {data.yAlign === "top" ? (
          <div
            className="arrow top"
            style={{ position: "absolute", top: -30, left: arrowLeft }}
          />
        ) : (
          <div
            className="arrow bottom"
            style={{ position: "absolute", bottom: -30, left: arrowLeft }}
          />
        )}
        <a
          role="button"
          style={{
            top: 3,
            right: 5,
          }}
          className="position-absolute text-gray cursor-pointer"
          onClick={close}
        >
          <BsX size={16} />
        </a>

        {/*tooltip contents*/}
        <AnalysisResultPopover
          data={data}
          ssrPolyfills={ssrPolyfills}
          differenceType={differenceType}
          isBandit={isBandit}
        />
      </div>
    </div>
  );
}
