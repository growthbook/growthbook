import React, { DetailedHTMLProps, HTMLAttributes } from "react";
import { MetricInterface } from "back-end/types/metric";
import { ExperimentReportVariation } from "back-end/types/report";
import { SnapshotMetric } from "back-end/types/experiment-snapshot";
import { PValueCorrection, StatsEngine } from "back-end/types/stats";
import { BsXCircle } from "react-icons/bs";
import { TooltipWithBounds } from "@visx/tooltip";
import clsx from "clsx";
import {
  FaArrowDown,
  FaArrowUp,
  FaHourglassHalf,
  FaQuestionCircle,
} from "react-icons/fa";
import { HiOutlineExclamationCircle } from "react-icons/hi";
import NotEnoughData from "@/components/Experiment/NotEnoughData";
import { pValueFormatter, RowResults } from "@/services/experiments";
import { GBSuspicious } from "@/components/Icons";
import Tooltip from "@/components/Tooltip/Tooltip";
import MetricValueColumn from "@/components/Experiment/MetricValueColumn";
import { formatConversionRate } from "@/services/metrics";
import { useCurrency } from "@/hooks/useCurrency";

export const TOOLTIP_WIDTH = 400;
export const TOOLTIP_HEIGHT = 300;
export const TOOLTIP_TIMEOUT = 250;
export type TooltipHoverSettings = {
  x: TooltipHoverX;
};
export type TooltipHoverX = "mouse-left" | "mouse-right" | "element-center";

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

  const variations = [data.baselineVariation, data.variation];
  const rows = [data.baseline, data.stats];

  const flags = [
    !data.rowResults.enoughData,
    data.rowResults.riskMeta.showRisk &&
      ["warning", "danger"].includes(data.rowResults.riskMeta.riskStatus) &&
      data.rowResults.resultsStatus !== "lost",
    data.rowResults.suspiciousChange,
  ];
  const hasFlaggedItems = flags.some((flag) => flag);

  return (
    <TooltipWithBounds
      left={left}
      top={top}
      style={{ position: "absolute", zIndex: 900 }}
    >
      <div
        className="experiment-row-tooltip"
        style={{ width: TOOLTIP_WIDTH, height: TOOLTIP_HEIGHT }}
        {...otherProps}
      >
        <a
          role="button"
          style={{
            top: 3,
            right: 5,
          }}
          className="position-absolute text-link cursor-pointer"
          onClick={close}
        >
          <BsXCircle size={16} />
        </a>

        {/*tooltip contents*/}
        <div className="px-2 py-1">
          <div className="metric-label d-flex align-items-end">
            <span className="h3 mb-0">{data.metric.name}</span>
            <span className="text-muted ml-2">({data.metric.type})</span>
          </div>

          <div
            className="variation-label mt-1 px-2 py-2 rounded"
            style={{ backgroundColor: "rgba(127, 127, 127, 0.05)" }}
          >
            <div
              className={`variation variation${data.variationRow} with-variation-label d-inline-flex align-items-center`}
            >
              <span className="label" style={{ width: 16, height: 16 }}>
                {data.variationRow}
              </span>
              <span className="d-inline-block text-ellipsis font-weight-bold">
                {data.variation.name}
              </span>
            </div>

            <div className="justify-content-end d-flex align-items-center text-muted">
              <div className="mr-2">baseline:</div>
              <div
                className={`variation variation${data.baselineRow} with-variation-label d-inline-flex align-items-center`}
              >
                <span className="label" style={{ width: 16, height: 16 }}>
                  {data.baselineRow}
                </span>
                <span className="d-inline-block text-ellipsis font-weight-bold">
                  {data.baselineVariation.name}
                </span>
              </div>
            </div>
          </div>

          <div
            className={clsx(
              "results-overview mt-3 px-3 py-2 rounded",
              data.rowResults.resultsStatus
            )}
          >
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
                  {data.rowResults.directionalStatus === "winning" ? (
                    <FaArrowUp />
                  ) : (
                    <FaArrowDown />
                  )}
                </span>{" "}
                <span className="expected bold">
                  {parseFloat(((data.stats.expected ?? 0) * 100).toFixed(1)) +
                    "%"}{" "}
                </span>
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
                  : pValueFormatter(data.stats.pValue ?? 1)}
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

          <div className="mt-3 results">
            <table className="table-condensed results-table">
              <thead>
                <tr>
                  <td>Variation</td>
                  <td>Users</td>
                  <td>Value</td>
                  <td>Total</td>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => {
                  return (
                    <tr key={i}>
                      <td
                        className="text-ellipsis"
                        style={{ maxWidth: "80px" }}
                      >
                        {variations[i].name}
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
    </TooltipWithBounds>
  );
}
