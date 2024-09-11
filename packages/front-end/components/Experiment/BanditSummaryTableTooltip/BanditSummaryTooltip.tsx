import React, { DetailedHTMLProps, HTMLAttributes, useEffect } from "react";
import { SnapshotMetric } from "back-end/types/experiment-snapshot";
import { BsXCircle } from "react-icons/bs";
import clsx from "clsx";
import { MdSwapCalls } from "react-icons/md";
import { isFactMetric } from "shared/experiments";
import { MetricInterface } from "back-end/types/metric";
import { BanditEvent } from "back-end/src/validators/experiments";
import Tooltip from "@/components/Tooltip/Tooltip";
import MetricValueColumn from "@/components/Experiment/MetricValueColumn";
import { PercentileLabel } from "@/components/Metrics/MetricName";

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

const numberFormatter = Intl.NumberFormat();

export interface TooltipData {
  variation: { id: string; index: number; name: string };
  probability?: number;
  stats: SnapshotMetric;
  currentEvent: BanditEvent;
  metric: MetricInterface;
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
}
export default function BanditSummaryTooltip({
  left,
  top,
  data,
  tooltipOpen,
  close,
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

  const metricInverseIconDisplay = data.metric.inverse ? (
    <Tooltip
      body="metric is inverse, lower is better"
      className="inverse-indicator ml-1"
      tipMinWidth={"180px"}
    >
      <MdSwapCalls />
    </Tooltip>
  ) : null;

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
          <BsXCircle size={16} />
        </a>

        {/*tooltip contents*/}
        <div className="px-2 py-1">
          <div className="metric-label d-flex align-items-end">
            <span
              className="h5 mb-0 text-dark text-ellipsis"
              style={{ maxWidth: 350 }}
            >
              {data.metric.name}
            </span>
            <PercentileLabel metric={data.metric} />
            {metricInverseIconDisplay}
            <span className="small text-muted ml-2">
              (
              {isFactMetric(data.metric)
                ? data.metric.metricType
                : data.metric.type}
              )
            </span>
          </div>

          <div
            className="variation-label mt-2 d-flex justify-content-between"
            style={{ gap: 8 }}
          >
            <div
              className={`variation variation${data.variation.index} with-variation-label d-inline-flex align-items-center`}
              style={{ maxWidth: 300 }}
            >
              <span className="label" style={{ width: 16, height: 16 }}>
                {data.variation.index}
              </span>
              <span className="d-inline-block text-ellipsis font-weight-bold">
                {data.variation.name}
              </span>
            </div>
          </div>

          <div className="mt-3 mb-2 results">
            <table className="table-condensed results-table">
              <thead>
                <tr>
                  <th>Users</th>
                  {/*todo: numerator*/}
                  {/*todo: (denominator)*/}
                  <th>Mean</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>{numberFormatter.format(data.stats.users)}</td>
                  <MetricValueColumn
                    metric={data.metric}
                    stats={data.stats}
                    users={data.stats.users}
                    showRatio={false}
                  />
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
