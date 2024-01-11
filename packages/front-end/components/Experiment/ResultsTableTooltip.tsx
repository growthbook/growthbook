import React, { DetailedHTMLProps, HTMLAttributes, useEffect } from "react";
import { ExperimentReportVariationWithIndex } from "back-end/types/report";
import { SnapshotMetric } from "back-end/types/experiment-snapshot";
import {
  DifferenceType,
  PValueCorrection,
  StatsEngine,
} from "back-end/types/stats";
import {
  BsXCircle,
  BsHourglassSplit,
  BsArrowReturnRight,
} from "react-icons/bs";
import clsx from "clsx";
import { FaArrowDown, FaArrowUp } from "react-icons/fa";
import { HiOutlineExclamationCircle } from "react-icons/hi";
import { RxInfoCircled } from "react-icons/rx";
import { MdSwapCalls } from "react-icons/md";
import { ExperimentMetricInterface, isFactMetric } from "shared/experiments";
import NotEnoughData from "@/components/Experiment/NotEnoughData";
import {
  getEffectLabel,
  pValueFormatter,
  RowResults,
} from "@/services/experiments";
import { GBSuspicious } from "@/components/Icons";
import Tooltip from "@/components/Tooltip/Tooltip";
import MetricValueColumn from "@/components/Experiment/MetricValueColumn";
import {
  formatNumber,
  formatPercent,
  getColumnRefFormatter,
  getExperimentMetricFormatter,
} from "@/services/metrics";
import { useCurrency } from "@/hooks/useCurrency";
import { capitalizeFirstLetter } from "@/services/utils";
import { useDefinitions } from "@/services/DefinitionsContext";
import usePValueThreshold from "@/hooks/usePValueThreshold";

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
const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

export interface TooltipData {
  metricRow: number;
  metric: ExperimentMetricInterface;
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
}
export default function ResultsTableTooltip({
  left,
  top,
  data,
  tooltipOpen,
  close,
  differenceType,
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

  const displayCurrency = useCurrency();

  const { getFactTableById } = useDefinitions();
  const pValueThreshold = usePValueThreshold();
  if (!data) {
    return null;
  }
  const deltaFormatter =
    differenceType === "relative"
      ? formatPercent
      : getExperimentMetricFormatter(data.metric, getFactTableById, true);
  const deltaFormatterOptions = {
    currency: displayCurrency,
    ...(differenceType === "relative" ? { maximumFractionDigits: 2 } : {}),
  };
  const effectLabel = getEffectLabel(differenceType);

  const rows = [data.baseline, data.stats];

  const flags = !data.isGuardrail
    ? [
        !data.rowResults.enoughData,
        data.rowResults.riskMeta.showRisk &&
          ["warning", "danger"].includes(data.rowResults.riskMeta.riskStatus) &&
          data.rowResults.resultsStatus !== "lost",
        data.rowResults.suspiciousChange,
      ]
    : [
        !data.rowResults.enoughData,
        data.rowResults.riskMeta.showRisk &&
          ["warning", "danger"].includes(data.rowResults.riskMeta.riskStatus) &&
          data.rowResults.resultsStatus !== "lost",
        data.rowResults.guardrailWarning,
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

  const confidencePct = percentFormatter.format(1 - pValueThreshold);

  let pValText = (
    <>
      {data.stats?.pValue !== undefined
        ? pValueFormatter(data.stats.pValue)
        : ""}
    </>
  );
  if (
    data.stats?.pValueAdjusted !== undefined &&
    data.pValueCorrection &&
    !data.isGuardrail
  ) {
    pValText = (
      <>
        <div>{pValueFormatter(data.stats.pValueAdjusted)}</div>
        <div className="text-muted font-weight-normal">
          (unadj.:&nbsp;{pValText})
        </div>
      </>
    );
  }
  let denomFormatter = formatNumber;
  const hasCustomDenominator =
    (isFactMetric(data.metric) && data.metric.metricType === "ratio") ||
    !!data.metric.denominator;
  if (
    hasCustomDenominator &&
    isFactMetric(data.metric) &&
    !!data.metric.denominator
  ) {
    denomFormatter = getColumnRefFormatter(
      data.metric.denominator,
      getFactTableById
    );
  }
  // Lift units
  const expected = data.stats?.expected ?? 0;
  const ci1 = data.stats?.ciAdjusted?.[1] ?? data.stats?.ci?.[1] ?? 0;
  const ci0 = data.stats?.ciAdjusted?.[0] ?? data.stats?.ci?.[0] ?? 0;
  const ciRangeText =
    data.stats?.ciAdjusted?.[0] !== undefined ? (
      <>
        <div>
          [{deltaFormatter(ci0, deltaFormatterOptions)},{" "}
          {deltaFormatter(ci1, deltaFormatterOptions)}]
        </div>
        <div className="text-muted font-weight-normal">
          (unadj.:&nbsp; [
          {deltaFormatter(data.stats.ci?.[0] ?? 0, deltaFormatterOptions)},{" "}
          {deltaFormatter(data.stats.ci?.[1] ?? 0, deltaFormatterOptions)}] )
        </div>
      </>
    ) : (
      <>
        [{deltaFormatter(data.stats.ci?.[0] ?? 0, deltaFormatterOptions)},{" "}
        {deltaFormatter(data.stats.ci?.[1] ?? 0, deltaFormatterOptions)}]
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
        <div className="px-2 py-1">
          {data.isGuardrail ? (
            <div
              className="uppercase-title text-muted mr-2"
              style={{ marginBottom: -2, fontSize: "10px" }}
            >
              guardrail
            </div>
          ) : null}
          <div className="metric-label d-flex align-items-end">
            <span
              className="h5 mb-0 text-dark text-ellipsis"
              style={{ maxWidth: 350 }}
            >
              {data.metric.name}
            </span>
            {metricInverseIconDisplay}
            <span className="text-muted ml-2">
              (
              {isFactMetric(data.metric)
                ? data.metric.metricType
                : data.metric.type}
              )
            </span>
          </div>
          {data.dimensionName ? (
            <div className="dimension-label d-flex align-items-center">
              <BsArrowReturnRight size={12} className="mx-1" />
              <span className="text-ellipsis" style={{ maxWidth: 150 }}>
                {data.dimensionName}
              </span>
              :{" "}
              <span
                className="ml-1 font-weight-bold text-ellipsis"
                style={{ maxWidth: 250 }}
              >
                {data.dimensionValue}
              </span>
            </div>
          ) : null}

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
              "results-overview mt-1 px-3 pb-2 rounded position-relative",
              data.rowResults.resultsStatus
            )}
            style={{ paddingTop: 12 }}
          >
            {["won", "lost", "draw"].includes(data.rowResults.resultsStatus) ||
            !data.rowResults.significant ? (
              <div
                className={clsx(
                  "results-status position-absolute d-flex align-items-center",
                  data.rowResults.resultsStatus,
                  {
                    "non-significant": !data.rowResults.significant,
                  }
                )}
              >
                <Tooltip
                  body={
                    <>
                      <p className="mb-0">
                        {data.rowResults.significant
                          ? data.rowResults.resultsReason
                          : data.rowResults.significantReason}
                      </p>
                      {data.statsEngine === "frequentist" &&
                      data.pValueCorrection &&
                      !data.isGuardrail ? (
                        <p className="mt-2 mb-0">
                          Note that p-values have been corrected using the{" "}
                          {data.pValueCorrection} method.
                        </p>
                      ) : null}
                    </>
                  }
                  tipMinWidth={"250px"}
                  className="cursor-pointer"
                >
                  <span style={{ marginRight: 12 }}>
                    {data.rowResults.significant
                      ? capitalizeFirstLetter(data.rowResults.resultsStatus)
                      : "Not significant"}
                  </span>
                  <RxInfoCircled
                    className="position-absolute"
                    style={{ top: 3, right: 4, fontSize: "14px" }}
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
              <div className="label mr-2">{effectLabel}:</div>
              <div
                className={clsx("value", {
                  "font-weight-bold": !data.isGuardrail
                    ? data.rowResults.significant
                    : data.rowResults.significantUnadjusted,
                  opacity50: !data.rowResults.enoughData,
                })}
              >
                <span className="expectedArrows">
                  {(data.rowResults.directionalStatus === "winning" &&
                    !data.metric.inverse) ||
                  (data.rowResults.directionalStatus === "losing" &&
                    data.metric.inverse) ? (
                    <FaArrowUp />
                  ) : (
                    <FaArrowDown />
                  )}
                </span>{" "}
                <span className="expected bold">
                  {deltaFormatter(
                    data.stats.expected ?? 0,
                    deltaFormatterOptions
                  )}
                </span>
                {data.statsEngine === "frequentist" ? (
                  <span className="plusminus ml-1">
                    ±
                    {Math.abs(ci0) === Infinity || Math.abs(ci1) === Infinity
                      ? "∞"
                      : deltaFormatter(
                          Math.abs(expected - ci0),
                          deltaFormatterOptions
                        )}
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
                  : `${confidencePct} Confidence Interval:`}
              </div>
              <div
                className={clsx("value nowrap", {
                  "font-weight-bold": !data.isGuardrail
                    ? data.rowResults.significant
                    : data.rowResults.significantUnadjusted,
                  opacity50: !data.rowResults.enoughData,
                })}
              >
                {ciRangeText}
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
                  "font-weight-bold": !data.isGuardrail
                    ? data.rowResults.significant
                    : data.rowResults.significantUnadjusted,
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
                  <Tooltip
                    className="cursor-pointer"
                    body={data.rowResults.enoughDataMeta.reason}
                  >
                    <div className="flagged d-flex border rounded p-1 flagged-not-enough-data">
                      <BsHourglassSplit
                        size={15}
                        className="flag-icon text-info"
                      />
                      <NotEnoughData
                        rowResults={data.rowResults}
                        showTimeRemaining={true}
                        showPercentComplete={true}
                        noStyle={true}
                      />
                    </div>
                  </Tooltip>
                ) : null}

                {data.rowResults.riskMeta.showRisk &&
                ["warning", "danger"].includes(
                  data.rowResults.riskMeta.riskStatus
                ) &&
                data.rowResults.resultsStatus !== "lost" ? (
                  <Tooltip
                    className="cursor-pointer"
                    body={data.rowResults.riskMeta.riskReason}
                  >
                    <div
                      className={clsx(
                        "flagged d-flex border rounded p-1 flagged-risk",
                        data.rowResults.riskMeta.riskStatus
                      )}
                    >
                      <HiOutlineExclamationCircle
                        size={18}
                        className="flag-icon"
                      />
                      <div className="risk">
                        <div className="risk-value">
                          risk: {data.rowResults.riskMeta.relativeRiskFormatted}
                        </div>
                        {data.rowResults.riskMeta.riskFormatted ? (
                          <div className="text-muted risk-relative">
                            {data.rowResults.riskMeta.riskFormatted}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </Tooltip>
                ) : null}

                {!data?.isGuardrail && data.rowResults.suspiciousChange ? (
                  <Tooltip
                    className="cursor-pointer"
                    body={data.rowResults.suspiciousChangeReason}
                  >
                    <div className="flagged d-flex border rounded p-1 flagged-suspicious suspicious">
                      <GBSuspicious size={18} className="flag-icon" />
                      <div className="suspicious-reason">
                        <div>suspicious</div>
                      </div>
                    </div>
                  </Tooltip>
                ) : null}

                {data.rowResults.guardrailWarning ? (
                  <Tooltip
                    className="cursor-pointer"
                    body={data.rowResults.guardrailWarning}
                  >
                    <div
                      className={clsx(
                        "flagged d-flex border rounded p-1 flagged-guardrail-warning warning"
                      )}
                    >
                      <HiOutlineExclamationCircle
                        size={18}
                        className="flag-icon"
                      />
                      <div className="guardrail-warning">
                        <div className="risk-value">
                          bad guardrail
                          <br />
                          trend
                        </div>
                      </div>
                    </div>
                  </Tooltip>
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
                  <th>Numerator</th>
                  {hasCustomDenominator ? <th>Denom.</th> : null}
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => {
                  const rowNumber =
                    i === 0
                      ? data?.baselineVariation.index
                      : data.variation.index;
                  const rowName =
                    i === 0 ? data.baselineVariation.name : data.variation.name;
                  return (
                    <tr key={i}>
                      <td style={{ width: 130, height: 40 }}>
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
                        {i === 0 ? (
                          <div
                            className="text-muted text-uppercase"
                            style={{
                              fontSize: "10px",
                              marginTop: -4,
                              marginLeft: 20,
                            }}
                          >
                            baseline
                          </div>
                        ) : null}
                      </td>
                      <td>{numberFormatter.format(row.users)}</td>

                      <td>
                        {getExperimentMetricFormatter(
                          data.metric,
                          getFactTableById,
                          true
                        )(row.value, { currency: displayCurrency })}
                      </td>
                      {hasCustomDenominator ? (
                        <td>
                          {denomFormatter(row.denominator || row.users, {
                            currency: displayCurrency,
                          })}
                        </td>
                      ) : null}
                      <MetricValueColumn
                        metric={data.metric}
                        stats={row}
                        users={row?.users || 0}
                        showRatio={false}
                      />
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
