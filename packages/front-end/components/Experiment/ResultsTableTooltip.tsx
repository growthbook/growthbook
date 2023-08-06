import React, { DetailedHTMLProps, HTMLAttributes } from "react";
import { MetricInterface } from "back-end/types/metric";
import { ExperimentReportVariation } from "back-end/types/report";
import { SnapshotMetric } from "back-end/types/experiment-snapshot";
import { PValueCorrection, StatsEngine } from "back-end/types/stats";
import { BsXCircle } from "react-icons/bs";
import clsx from "clsx";
import {
  FaArrowDown,
  FaArrowUp,
  FaHourglassHalf,
  FaInfoCircle,
  FaQuestionCircle,
} from "react-icons/fa";
import { HiOutlineExclamationCircle } from "react-icons/hi";
import { MdSwapCalls } from "react-icons/md";
import NotEnoughData from "@/components/Experiment/NotEnoughData";
import { pValueFormatter, RowResults } from "@/services/experiments";
import { GBSuspicious } from "@/components/Icons";
import Tooltip from "@/components/Tooltip/Tooltip";
import MetricValueColumn from "@/components/Experiment/MetricValueColumn";
import { formatConversionRate } from "@/services/metrics";
import { useCurrency } from "@/hooks/useCurrency";
import { capitalizeFirstLetter } from "@/services/utils";

export const TOOLTIP_WIDTH = 400;
export const TOOLTIP_HEIGHT = 400;
export const TOOLTIP_TIMEOUT = 250;
export type TooltipHoverSettings = {
  x: LayoutX;
};
export type LayoutX = "mouse-left" | "mouse-right" | "element-center";

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

export interface TooltipData {
  metricRow: number;
  variationRow: number;
  metric: MetricInterface;
  variation: ExperimentReportVariation;
  stats: SnapshotMetric;
  baseline: SnapshotMetric;
  baselineVariation: ExperimentReportVariation;
  baselineRow: number;
  rowResults: RowResults;
  statsEngine: StatsEngine;
  pValueCorrection?: PValueCorrection;
  isGuardrail: boolean;
  layoutX: LayoutX;
  yAlign: "top" | "bottom";
}

interface Props
  extends DetailedHTMLProps<HTMLAttributes<HTMLDivElement>, HTMLDivElement> {
  left: number;
  top: number;
  data: TooltipData;
  close: () => void;
}
export default function ResultsTableTooltip({
  left,
  top,
  data,
  close,
  ...otherProps
}: Props) {
  const displayCurrency = useCurrency();

  if (!data) {
    return null;
  }

  const rows = [data.baseline, data.stats];

  const flags = [
    !data.rowResults.enoughData,
    data.rowResults.riskMeta.showRisk &&
      ["warning", "danger"].includes(data.rowResults.riskMeta.riskStatus) &&
      data.rowResults.resultsStatus !== "lost",
    data.rowResults.suspiciousChange,
  ];
  const hasFlaggedItems = flags.some((flag) => flag);

  const metricInverseIconDisplay = data.metric.inverse ? (
    <Tooltip
      body="metric is inverse, lower is better"
      className="inverse-indicator ml-1"
      tipMinWidth={"180px"}
    >
      <MdSwapCalls />
    </Tooltip>
  ) : null;

  let pValText = (
    <>
      {data.stats?.pValue !== undefined
        ? pValueFormatter(data.stats.pValue)
        : ""}
    </>
  );
  if (data.stats?.pValueAdjusted !== undefined && data.pValueCorrection) {
    pValText = (
      <>
        <div>
          {data.stats?.pValueAdjusted
            ? pValueFormatter(data.stats.pValueAdjusted)
            : ""}
        </div>
        <div className="small text-muted">(unadj.:&nbsp;{pValText})</div>
      </>
    );
  }

  const arrowLeft =
    data.layoutX === "mouse-left"
      ? "10%"
      : data.layoutX === "mouse-right"
      ? "90%"
      : "50%";

  return (
    <div
      className="experiment-row-tooltip-wrapper"
      style={{
        position: "absolute",
        zIndex: 900,
        width: TOOLTIP_WIDTH,
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
          width: TOOLTIP_WIDTH,
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
            <span className="h5 mb-0 text-dark">{data.metric.name}</span>
            {metricInverseIconDisplay}
            <span className="text-muted ml-2">({data.metric.type})</span>
          </div>

          <div
            className="variation-label mt-2 d-flex justify-content-between"
            style={{ gap: 8 }}
          >
            <div
              className={`variation variation${data.variationRow} with-variation-label d-inline-flex align-items-center`}
              style={{ maxWidth: 300 }}
            >
              <span className="label" style={{ width: 16, height: 16 }}>
                {data.variationRow}
              </span>
              <span className="d-inline-block text-ellipsis font-weight-bold">
                {data.variation.name}
              </span>
            </div>
          </div>

          <div
            className={clsx(
              "results-overview mt-1 px-3 py-2 rounded position-relative",
              data.rowResults.resultsStatus
            )}
          >
            {["won", "lost", "draw"].includes(data.rowResults.resultsStatus) ? (
              <div
                className={clsx(
                  "results-status border position-absolute d-flex align-items-center",
                  data.rowResults.resultsStatus
                )}
              >
                <Tooltip
                  body={data.rowResults.resultsReason}
                  tipMinWidth={"250px"}
                >
                  <span style={{ marginRight: 14 }}>
                    {capitalizeFirstLetter(data.rowResults.resultsStatus)}
                  </span>
                  <FaInfoCircle
                    className="position-absolute"
                    style={{ top: 4, right: 4 }}
                  />
                </Tooltip>
              </div>
            ) : null}
            <div
              className={clsx(
                "results-change d-flex",
                data.rowResults.directionalStatus
              )}
            >
              <div className="label mr-2">% Change:</div>
              <div
                className={clsx("value", {
                  "font-weight-bold": data.rowResults.enoughData,
                  opacity50: !data.rowResults.enoughData,
                })}
              >
                <span className="expectedArrows">
                  {data.rowResults.directionalStatus === "winning" ||
                  (data.rowResults.directionalStatus === "losing" &&
                    data.metric.inverse) ? (
                    <FaArrowUp />
                  ) : (
                    <FaArrowDown />
                  )}
                </span>{" "}
                <span className="expected bold">
                  {parseFloat(((data.stats.expected ?? 0) * 100).toFixed(1)) +
                    "%"}
                </span>
                {data.statsEngine === "frequentist" ? (
                  <span className="plusminus ml-1">
                    {"±" +
                      parseFloat(
                        (
                          Math.abs(
                            (data.stats.expected ?? 0) -
                              (data.stats.ci?.[0] ?? 0)
                          ) * 100
                        ).toFixed(1)
                      ) +
                      "%"}
                  </span>
                ) : null}
              </div>
            </div>

            <div
              className={clsx(
                "results-ci d-flex mt-1",
                data.rowResults.resultsStatus
              )}
            >
              <div className="label mr-2">
                {data.statsEngine === "bayesian"
                  ? "95% Credible Interval:"
                  : "95% Confidence Interval:"}
              </div>
              <div
                className={clsx("value nowrap", {
                  "font-weight-bold": data.rowResults.enoughData,
                  opacity50: !data.rowResults.enoughData,
                })}
              >
                [{percentFormatter.format(data.stats.ci?.[0] ?? 0)},{" "}
                {percentFormatter.format(data.stats.ci?.[1] ?? 0)}]
              </div>
            </div>

            <div
              className={clsx(
                "results-chance d-flex mt-1",
                data.rowResults.resultsStatus
              )}
            >
              <div className="label mr-2">
                {data.statsEngine === "bayesian"
                  ? "Chance to Win:"
                  : "P-Value:"}
              </div>
              <div
                className={clsx("value", {
                  "font-weight-bold": data.rowResults.enoughData,
                  opacity50: !data.rowResults.enoughData,
                })}
              >
                {data.statsEngine === "bayesian"
                  ? percentFormatter.format(data.stats.chanceToWin ?? 0)
                  : pValText}
              </div>
            </div>

            {hasFlaggedItems ? (
              <div
                className="results-flagged-items d-flex align-items-start mt-2"
                style={{ gap: 12 }}
              >
                {!data.rowResults.enoughData ? (
                  <div className="d-flex border rounded p-1 flagged-not-enough-data">
                    <FaHourglassHalf size={14} className="mr-1 text-info" />
                    <NotEnoughData
                      rowResults={data.rowResults}
                      showTimeRemaining={true}
                      showPercentComplete={true}
                    />
                  </div>
                ) : null}

                {data.rowResults.riskMeta.showRisk &&
                ["warning", "danger"].includes(
                  data.rowResults.riskMeta.riskStatus
                ) &&
                data.rowResults.resultsStatus !== "lost" ? (
                  <div
                    className={clsx(
                      "d-flex border rounded p-1 flagged-risk",
                      data.rowResults.riskMeta.riskStatus
                    )}
                  >
                    <HiOutlineExclamationCircle size={18} className="mr-1" />
                    <div className="risk">
                      <div
                        className="risk-value"
                        style={{ fontSize: "11px", lineHeight: "14px" }}
                      >
                        risk: {data.rowResults.riskMeta.relativeRiskFormatted}
                      </div>
                      {data.rowResults.riskMeta.riskFormatted ? (
                        <div className="small text-muted risk-relative">
                          {data.rowResults.riskMeta.riskFormatted}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                {data.rowResults.suspiciousChange ? (
                  <div className="d-flex border rounded p-1 flagged-suspicious suspicious">
                    <GBSuspicious size={18} className="mr-1" />
                    <div className="suspicious-reason">
                      <Tooltip
                        popperClassName="text-main"
                        tipMinWidth={"250px"}
                        body={data.rowResults.suspiciousChangeReason}
                      >
                        <span style={{ fontSize: "11px", lineHeight: "14px" }}>
                          suspicious <FaQuestionCircle />
                        </span>
                      </Tooltip>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="mt-3 mb-2 results">
            <table className="table-condensed results-table">
              <thead>
                <tr>
                  <th style={{ width: 130 }}>Variation</th>
                  <th>Users</th>
                  <th>Value</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => {
                  const rowNumber =
                    i === 0 ? data.baselineRow : data.variationRow;
                  const rowName =
                    i === 0 ? data.baselineVariation.name : data.variation.name;
                  return (
                    <tr key={i}>
                      <td style={{ width: 130 }}>
                        <div
                          className={`variation variation${rowNumber} with-variation-label d-inline-flex align-items-center`}
                        >
                          <span
                            className="label"
                            style={{ width: 16, height: 16 }}
                          >
                            {rowNumber}
                          </span>
                          <span
                            className="d-inline-block text-ellipsis"
                            style={{ width: 90 }}
                          >
                            {rowName}
                          </span>
                        </div>
                      </td>
                      <td>{row.users}</td>
                      <MetricValueColumn
                        metric={data.metric}
                        stats={row}
                        users={row?.users || 0}
                        showRatio={false}
                      />
                      <td>
                        {formatConversionRate(
                          data.metric.type === "binomial"
                            ? "count"
                            : data.metric.type,
                          row.value,
                          displayCurrency
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
