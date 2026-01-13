import React, { DetailedHTMLProps, HTMLAttributes, useEffect } from "react";
import { SnapshotMetric } from "shared/types/experiment-snapshot";
import { BsXCircle } from "react-icons/bs";
import clsx from "clsx";
import { MdSwapCalls } from "react-icons/md";
import { isFactMetric } from "shared/experiments";
import { MetricInterface } from "shared/types/metric";
import { BanditEvent } from "shared/validators";
import { RxInfoCircled } from "react-icons/rx";
import { HiOutlineExclamationCircle } from "react-icons/hi";
import Tooltip from "@/components/Tooltip/Tooltip";
import { PercentileLabel } from "@/components/Metrics/MetricName";
import { WIN_THRESHOLD_PROBABILITY } from "@/components/Experiment/BanditSummaryTable";
import { getExperimentMetricFormatter } from "@/services/metrics";
import { useCurrency } from "@/hooks/useCurrency";
import { useDefinitions } from "@/services/DefinitionsContext";
import { GBCuped } from "@/components/Icons";
import { SSRPolyfills } from "@/hooks/useSSRPolyfills";

export const TOOLTIP_WIDTH = 350;
export const TOOLTIP_HEIGHT = 300; // Used for over/under layout calculation. Actual height may vary.
export const TOOLTIP_TIMEOUT = 250; // Mouse-out delay before closing
export type TooltipHoverSettings = {
  x: LayoutX;
  offsetX?: number;
  offsetY?: number;
  targetClassName?: string;
};
export type LayoutX = "element-center" | "element-left" | "element-right";
export type YAlign = "top" | "bottom";

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 1,
});

export interface TooltipData {
  variation: { id: string; index: number; name: string };
  probability?: number;
  stats: SnapshotMetric;
  status: "won" | "";
  currentEvent: BanditEvent;
  regressionAdjustmentEnabled: boolean;
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
  ssrPolyfills?: SSRPolyfills;
}
export default function BanditSummaryTooltip({
  left,
  top,
  data,
  tooltipOpen,
  close,
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

  const _displayCurrency = useCurrency();
  const { getFactTableById: _getFactTableById } = useDefinitions();

  const getFactTableById = ssrPolyfills?.getFactTableById || _getFactTableById;
  const displayCurrency = ssrPolyfills?.useCurrency() || _displayCurrency;
  const metricFormatterOptions = { currency: displayCurrency };

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

  const meanText = data.metric
    ? getExperimentMetricFormatter(data.metric, getFactTableById)(
        data.stats.cr ?? 0,
        metricFormatterOptions,
      )
    : (data.stats.cr ?? 0) + "";

  const ciRangeText = (
    <>
      [
      {data.metric
        ? getExperimentMetricFormatter(data.metric, getFactTableById)(
            data.stats.ci?.[0] ?? 0,
            metricFormatterOptions,
          )
        : (data.stats.ci?.[0] ?? 0)}
      ,{" "}
      {data.metric
        ? getExperimentMetricFormatter(data.metric, getFactTableById)(
            data.stats.ci?.[1] ?? 0,
            metricFormatterOptions,
          )
        : (data.stats.ci?.[1] ?? 0)}
      ]
    </>
  );
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
        <div className="px-2 pt-1 pb-3">
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

          <div
            className={clsx(
              "results-overview mt-2 px-3 pb-2 rounded position-relative",
              data.status,
            )}
            style={{ paddingTop: 12 }}
          >
            {data.status === "won" ? (
              <div
                className={clsx(
                  "results-status position-absolute d-flex align-items-center",
                  data.status,
                )}
              >
                <Tooltip
                  body={
                    <p className="mb-0">
                      The probability of winning is above the{" "}
                      {WIN_THRESHOLD_PROBABILITY} threshold.
                    </p>
                  }
                  tipMinWidth={"250px"}
                  className="cursor-pointer"
                >
                  <span style={{ marginRight: 12 }}>Won</span>
                  <RxInfoCircled
                    className="position-absolute"
                    style={{ top: 3, right: 4, fontSize: "14px" }}
                  />
                </Tooltip>
              </div>
            ) : null}

            <div className={clsx("results-chance d-flex mt-0", data.status)}>
              <div className="label mr-2" style={{ width: 140 }}>
                Probability of Winning:
              </div>
              <div
                className={clsx("value", {
                  "font-weight-bold": isFinite(data.probability ?? NaN),
                })}
              >
                {isFinite(data.probability ?? NaN) ? (
                  percentFormatter.format(data?.probability ?? 0)
                ) : (
                  <em className="text-muted">
                    <small>not enough data</small>
                  </em>
                )}
              </div>
            </div>

            <hr className="my-2" />

            <div className={clsx("results-chance d-flex mt-1", data.status)}>
              <div className="label mr-2" style={{ width: 140 }}>
                Variation Mean:
              </div>
              <div
                className={clsx("value", {
                  "font-weight-bold": isFinite(data.probability ?? NaN),
                })}
              >
                {meanText}
              </div>
            </div>

            <div className={clsx("results-ci d-flex mt-1", data.status)}>
              <div className="label mr-2" style={{ width: 140 }}>
                95% CI:
              </div>
              <div className="value">{ciRangeText}</div>
            </div>

            {data.regressionAdjustmentEnabled && (
              <div className="mt-3">
                <Tooltip body="Credible intervals have been adjusted using CUPED and are scaled to represent variation means. They are not actual credible intervals for variation means.">
                  <div className="mt-1 text-muted">
                    <GBCuped size={13} /> CUPED affects results{" "}
                    <HiOutlineExclamationCircle />
                  </div>
                </Tooltip>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
