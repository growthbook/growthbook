import Link from "next/link";
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
import {
  BsXCircle,
  BsHourglassSplit,
  BsArrowReturnRight,
} from "react-icons/bs";
import clsx from "clsx";
import { FaArrowDown, FaArrowUp, FaQuestionCircle } from "react-icons/fa";
import { HiOutlineExclamationCircle } from "react-icons/hi";
import { RxInfoCircled } from "react-icons/rx";
import { MdSwapCalls } from "react-icons/md";
import {
  ExperimentMetricInterface,
  isFactMetric,
  quantileMetricType,
} from "shared/experiments";
import { DEFAULT_PROPER_PRIOR_STDDEV } from "shared/constants";
import { Box, Flex, Text } from "@radix-ui/themes";
import { PiInfo } from "react-icons/pi";
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
  getMetricFormatter,
  getPercentileLabel,
} from "@/services/metrics";
import { useCurrency } from "@/hooks/useCurrency";
import { capitalizeFirstLetter } from "@/services/utils";
import { useDefinitions } from "@/services/DefinitionsContext";
import usePValueThreshold from "@/hooks/usePValueThreshold";
import { PercentileLabel } from "@/components/Metrics/MetricName";
import { SSRPolyfills } from "@/hooks/useSSRPolyfills";
import Table, {
  TableHeader,
  TableRow,
  TableColumnHeader,
  TableBody,
  TableCell,
} from "@/components/Radix/Table";
import Callout from "@/components/Radix/Callout";
import FlagCard from "@/components/FlagCard/FlagCard";
import { getVariationColor } from "@/services/features";

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
  console.log("row results", data?.rowResults)
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

  const _currency = useCurrency();
  const displayCurrency = ssrPolyfills?.useCurrency?.() || _currency;

  const { getExperimentMetricById, getFactTableById } = useDefinitions();

  const _pValueThreshold = usePValueThreshold();
  const pValueThreshold =
    ssrPolyfills?.usePValueThreshold?.() || _pValueThreshold;

  if (!data) {
    return null;
  }

  const deltaFormatter =
    differenceType === "relative"
      ? formatPercent
      : getExperimentMetricFormatter(
          data.metric,
          ssrPolyfills?.getFactTableById || getFactTableById,
          differenceType === "absolute" ? "percentagePoints" : "number"
        );
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
  console.log({flags})
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
    ((isFactMetric(data.metric) && data.metric.metricType === "ratio") ||
      !!data.metric.denominator) &&
    !quantileMetricType(data.metric);
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
  const quantileMetric = quantileMetricType(data.metric);
  const quantileIgnoreZeros =
    isFactMetric(data.metric) && data.metric.quantileSettings?.ignoreZeros;
  const quantileValue = isFactMetric(data.metric)
    ? data.metric.quantileSettings?.quantile
    : undefined;
  // Lift units
  const ci1 = data.stats?.ciAdjusted?.[1] ?? data.stats?.ci?.[1] ?? Infinity;
  const ci0 = data.stats?.ciAdjusted?.[0] ?? data.stats?.ci?.[0] ?? -Infinity;
  const ciRangeText =
    data.stats?.ciAdjusted?.[0] !== undefined ? (
      <>
        <div>
          [{deltaFormatter(ci0, deltaFormatterOptions)},{" "}
          {deltaFormatter(ci1, deltaFormatterOptions)}]
        </div>
        <div className="text-muted font-weight-normal">
          (unadj.:&nbsp; [
          {deltaFormatter(
            data.stats.ci?.[0] ?? -Infinity,
            deltaFormatterOptions
          )}
          ,{" "}
          {deltaFormatter(
            data.stats.ci?.[1] ?? Infinity,
            deltaFormatterOptions
          )}
          ] )
        </div>
      </>
    ) : (
      <>
        [
        {deltaFormatter(data.stats.ci?.[0] ?? -Infinity, deltaFormatterOptions)}
        ,{" "}
        {deltaFormatter(data.stats.ci?.[1] ?? Infinity, deltaFormatterOptions)}]
      </>
    );

  const priorUsed =
    data.statsEngine === "bayesian" && data.metricSnapshotSettings?.properPrior;
  const cupedUsed = data.metricSnapshotSettings?.regressionAdjustmentEnabled;
  const addLiftWarning = priorUsed || cupedUsed;

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
        <Box p="2">
          {data.isGuardrail ? (
            <div
              className="uppercase-title text-muted mr-2"
              style={{ marginBottom: -2, fontSize: "10px" }}
            >
              guardrail
            </div>
          ) : null}

          <Flex direction="column" gap="2" mb="2">
            <Flex gap="1" align="center">
              <Text
                weight="medium"
                size="2"
                className="text-ellipsis"
                style={{ maxWidth: 350 }}
              >
                {data.metric.name}
              </Text>
              <PercentileLabel metric={data.metric} />
              <span className="small text-muted ml-2">
                (
                {isFactMetric(data.metric)
                  ? data.metric.metricType
                  : data.metric.type}
                )
              </span>
              {metricInverseIconDisplay}
            </Flex>

            {data.dimensionName ? (
              <Flex ml="1" gap="1" mt="-2" align="center">
                <BsArrowReturnRight size={12} />
                <Flex gap="1">
                  <span className="text-ellipsis" style={{ maxWidth: 150 }}>
                    {data.dimensionName}:
                  </span>
                  <span
                    className="font-weight-bold text-ellipsis"
                    style={{ maxWidth: 250 }}
                  >
                    {data.dimensionValue}
                  </span>
                </Flex>
              </Flex>
            ) : null}

            <Flex align="center" gap="2" className="variation-label">
              <span
                style={{
                  color: getVariationColor(data.variation.index, true),
                  borderColor: getVariationColor(data.variation.index, true),
                  fontSize: "12px",
                  width: 16,
                  height: 16,
                  borderRadius: 16,
                  borderWidth: 1,
                  borderStyle: "solid",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                {data.variation.index}
              </span>
              <Text weight="bold" className="text-ellipsis">
                {data.variation.name}
              </Text>
            </Flex>
          </Flex>

          <Box
            mb="3"
            className={clsx("results-overview", data.rowResults.resultsStatus)}
          >
            <FlagCard
              effectLabel={effectLabel}
              deltaFormatter={deltaFormatter}
              deltaFormatterOptions={deltaFormatterOptions}
              pValueThreshold={pValueThreshold}
              data={data}
            />
          </Box>

          <Flex direction="column" gap="2">
            {addLiftWarning && data.rowResults.enoughData ? (
              <Callout size="sm" status="warning">
                {priorUsed && cupedUsed ? (
                  <>CUPED and Bayesian Priors affect results</>
                ) : priorUsed ? (
                  <>Bayesian Priors affect results</>
                ) : (
                  <>CUPED affects results</>
                )}{" "}
                <Tooltip
                  className="cursor-pointer"
                  body={
                    <>
                      {priorUsed ? (
                        <div className="mb-1">
                          {`This metric was analyzed with a prior that is normally distributed with mean ${
                            data.metricSnapshotSettings?.properPriorMean ?? 0
                          } and standard deviation ${
                            data.metricSnapshotSettings?.properPriorStdDev ??
                            DEFAULT_PROPER_PRIOR_STDDEV
                          }.`}
                        </div>
                      ) : null}
                      {cupedUsed ? (
                        <div className="mb-1">
                          {`This metric was analyzed with CUPED, which adjusts for covariates.`}
                        </div>
                      ) : null}
                      <div>
                        {`This affects metrics results (e.g., lift, ${
                          data.statsEngine === "bayesian"
                            ? "chance to win, credible intervals"
                            : "p-values, confidence intervals"
                        }), and estimated lift will often differ from the raw difference between variation and baseline.`}
                      </div>
                    </>
                  }
                >
                  <span>
                    <PiInfo size={16} />
                  </span>
                </Tooltip>
              </Callout>
            ) : null}

            {/*{!data.rowResults.enoughData ? (*/}
            {/*  <Tooltip*/}
            {/*    className="cursor-pointer"*/}
            {/*    body={data.rowResults.enoughDataMeta.reasonText}*/}
            {/*  >*/}
            {/*    <Callout size="sm" status="info">*/}
            {/*      <Flex align="center" gap="2">*/}
            {/*        <BsHourglassSplit size={15} className="text-info" />*/}
            {/*        <NotEnoughData*/}
            {/*          rowResults={data.rowResults}*/}
            {/*          showTimeRemaining={true}*/}
            {/*          showPercentComplete={true}*/}
            {/*          noStyle={true}*/}
            {/*        />*/}
            {/*      </Flex>*/}
            {/*    </Callout>*/}
            {/*  </Tooltip>*/}
            {/*) : null}*/}

            {/*{data.rowResults.riskMeta.showRisk &&*/}
            {/*["warning", "danger"].includes(*/}
            {/*  data.rowResults.riskMeta.riskStatus*/}
            {/*) &&*/}
            {/*data.rowResults.resultsStatus !== "lost" ? (*/}
            {/*  <Tooltip*/}
            {/*    className="cursor-pointer"*/}
            {/*    body={data.rowResults.riskMeta.riskReason}*/}
            {/*  >*/}
            {/*    <Callout*/}
            {/*      size="sm"*/}
            {/*      status={*/}
            {/*        data.rowResults.riskMeta.riskStatus === "danger"*/}
            {/*          ? "error"*/}
            {/*          : "warning"*/}
            {/*      }*/}
            {/*    >*/}
            {/*      <Flex align="center" gap="2">*/}
            {/*        <Link*/}
            {/*          href="https://docs.growthbook.io/using/experimenting#bayesian-results"*/}
            {/*          target="_blank"*/}
            {/*        >*/}
            {/*          <FaQuestionCircle size={12} />*/}
            {/*        </Link>*/}
            {/*        <div className="risk">*/}
            {/*          <div className="risk-value">*/}
            {/*            risk: {data.rowResults.riskMeta.relativeRiskFormatted}*/}
            {/*          </div>*/}
            {/*          {data.rowResults.riskMeta.riskFormatted ? (*/}
            {/*            <div className="text-muted risk-relative">*/}
            {/*              {data.rowResults.riskMeta.riskFormatted}*/}
            {/*            </div>*/}
            {/*          ) : null}*/}
            {/*        </div>*/}
            {/*      </Flex>*/}
            {/*    </Callout>*/}
            {/*  </Tooltip>*/}
            {/*) : null}*/}

            {/* suspicious flag moved into results-overview flags array */}

            {data.rowResults.guardrailWarning ? (
              <Tooltip
                className="cursor-pointer"
                body={data.rowResults.guardrailWarning}
              >
                <Callout size="sm" status="warning">
                  <Flex align="center" gap="2">
                    <HiOutlineExclamationCircle size={18} />
                    <div className="guardrail-warning">
                      <div className="risk-value">
                        bad guardrail
                        <br />
                        trend
                      </div>
                    </div>
                  </Flex>
                </Callout>
              </Tooltip>
            ) : null}
          </Flex>

          <Box mt="3" mb="2" className="results">
            <Table size="1">
              <TableHeader>
                <TableRow style={{ color: "var(--color-text-mid)" }}>
                  <TableColumnHeader pl="0" style={{ width: 130 }}>
                    Variation
                  </TableColumnHeader>
                  <TableColumnHeader justify="end">
                    {quantileMetric && quantileIgnoreZeros ? "Non-zero " : ""}
                    {quantileMetric === "event" ? "Events" : "Users"}
                  </TableColumnHeader>
                  {!quantileMetric ? (
                    <TableColumnHeader justify="end">
                      Numerator
                      {isBandit && (
                        <>
                          <br />
                          <div className="small" style={{ marginTop: -2 }}>
                            (adjusted)
                          </div>
                        </>
                      )}
                    </TableColumnHeader>
                  ) : null}
                  {hasCustomDenominator ? (
                    <TableColumnHeader justify="end">Denom.</TableColumnHeader>
                  ) : null}
                  {quantileMetric && quantileValue ? (
                    <TableColumnHeader justify="end">
                      {getPercentileLabel(quantileValue)}
                    </TableColumnHeader>
                  ) : (
                    <TableColumnHeader justify="end">Value</TableColumnHeader>
                  )}
                </TableRow>
              </TableHeader>

              <TableBody>
                {rows.map((row, i) => {
                  const rowNumber =
                    i === 0
                      ? data?.baselineVariation.index
                      : data.variation.index;
                  const rowName =
                    i === 0 ? data.baselineVariation.name : data.variation.name;
                  const variationColor = getVariationColor(rowNumber, true);
                  return (
                    <TableRow
                      key={`result_tooltip_row_${i}`}
                      style={{
                        color: "var(--color-text-high)",
                        fontWeight: 500,
                      }}
                    >
                      <TableCell pl="0">
                        <Flex align="start" gap="2">
                          <span
                            style={{
                              color: variationColor,
                              borderColor: variationColor,
                              fontSize: "12px",
                              width: 16,
                              height: 16,
                              borderRadius: 16,
                              borderWidth: 1,
                              borderStyle: "solid",
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              flexShrink: 0,
                              marginTop: 2,
                            }}
                          >
                            {rowNumber}
                          </span>
                          <Flex direction="column">
                            <Text
                              weight="bold"
                              className="text-ellipsis"
                              style={{ maxWidth: 90 }}
                            >
                              {rowName}
                            </Text>
                            {i === 0 ? (
                              <Text
                                size="1"
                                style={{ color: "var(--color-text-mid)" }}
                                weight="regular"
                              >
                                BASELINE
                              </Text>
                            ) : null}
                          </Flex>
                        </Flex>
                      </TableCell>

                      <TableCell justify="end">
                        {quantileMetric && row.stats
                          ? numberFormatter.format(row.stats.count)
                          : numberFormatter.format(row.users)}
                      </TableCell>

                      {!quantileMetric ? (
                        <TableCell justify="end">
                          {isFactMetric(data.metric)
                            ? getColumnRefFormatter(
                                data.metric.numerator,
                                ssrPolyfills?.getFactTableById ||
                                  getFactTableById
                              )(row.value, { currency: displayCurrency })
                            : getMetricFormatter(
                                data.metric.type === "binomial"
                                  ? "count"
                                  : data.metric.type
                              )(row.value, { currency: displayCurrency })}
                        </TableCell>
                      ) : null}

                      {hasCustomDenominator ? (
                        <TableCell justify="end">
                          {denomFormatter(row.denominator || row.users, {
                            currency: displayCurrency,
                          })}
                        </TableCell>
                      ) : null}

                      <TableCell justify="end">
                        <MetricValueColumn
                          metric={data.metric}
                          stats={row}
                          users={row?.users || 0}
                          showRatio={false}
                          displayCurrency={displayCurrency}
                          getExperimentMetricById={
                            ssrPolyfills?.getExperimentMetricById ||
                            getExperimentMetricById
                          }
                          getFactTableById={
                            ssrPolyfills?.getFactTableById || getFactTableById
                          }
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Box>
        </Box>
      </div>
    </div>
  );
}
