import React from "react";
import { Box, Flex, Text, Tooltip } from "@radix-ui/themes";
import {
  ExperimentReportVariationWithIndex,
  MetricSnapshotSettings,
} from "back-end/types/report";
import {
  DifferenceType,
  PValueCorrection,
  StatsEngine,
} from "back-end/types/stats";
import { SnapshotMetric } from "back-end/types/experiment-snapshot";
import {
  ExperimentMetricInterface,
  quantileMetricType,
  isFactMetric,
} from "shared/experiments";
import { DEFAULT_PROPER_PRIOR_STDDEV } from "shared/constants";
import { MdSwapCalls } from "react-icons/md";
import { BsArrowReturnRight } from "react-icons/bs";
import { PiInfo } from "react-icons/pi";
import Table, {
  TableHeader,
  TableRow,
  TableColumnHeader,
  TableBody,
  TableCell,
} from "@/components/Radix/Table";
import { SSRPolyfills } from "@/hooks/useSSRPolyfills";
import { getVariationColor } from "@/services/features";
import { getEffectLabel, RowResults } from "@/services/experiments";
import {
  formatNumber,
  formatPercent,
  getColumnRefFormatter,
  getExperimentMetricFormatter,
  getPercentileLabel,
} from "@/services/metrics";
import { useCurrency } from "@/hooks/useCurrency";
import { useDefinitions } from "@/services/DefinitionsContext";
import usePValueThreshold from "@/hooks/usePValueThreshold";
import FlagCard from "../FlagCard/FlagCard";
import { PercentileLabel } from "../Metrics/MetricName";
import MetricValueColumn from "../SafeRollout/Results/MetricValueColumn";
import Callout from "../Radix/Callout";

interface AnalysisResultPopoverProps {
  data?: {
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
  };
  differenceType: DifferenceType;
  isBandit?: boolean;
  ssrPolyfills?: SSRPolyfills;
  targetElement?: HTMLElement | null;
  onClose?: () => void;
}

const numberFormatter = Intl.NumberFormat();

export default function AnalysisResultPopover({
  data,
  differenceType,
  isBandit,
  ssrPolyfills,
  targetElement,
  onClose,
}: AnalysisResultPopoverProps) {
  // Add click outside handler
  React.useEffect(() => {
    if (!onClose) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (!targetElement?.contains(event.target as Node)) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onClose, targetElement]);

  // Add positioning styles based on target element
  const [position, setPosition] = React.useState({ top: 0, left: 0 });
  const popoverRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!targetElement || !popoverRef.current) return;

    const targetRect = targetElement.getBoundingClientRect();
    const popoverRect = popoverRef.current.getBoundingClientRect();
    
    // Position below the target element with some offset
    const top = targetRect.bottom + window.scrollY + 5;
    let left = targetRect.left + window.scrollX + (targetRect.width / 2) - (popoverRect.width / 2);
    
    // Adjust if popover would go off screen
    if (left < 10) left = 10;
    if (left + popoverRect.width > window.innerWidth - 10) {
      left = window.innerWidth - popoverRect.width - 10;
    }
    
    setPosition({ top, left });
  }, [targetElement]);

  if (!data || !targetElement) return null;
  
  // Initialize hooks and utilities
  const _currency = useCurrency();
  const displayCurrency = ssrPolyfills?.useCurrency?.() || _currency;
  const { getExperimentMetricById, getFactTableById } = useDefinitions();
  const _pValueThreshold = usePValueThreshold();
  const pValueThreshold = ssrPolyfills?.usePValueThreshold?.() || _pValueThreshold;

  // Formatters and derived values
  const deltaFormatter = differenceType === "relative"
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
  const variationColor = getVariationColor(data.variation.index, true);

  // Handle metric display and formatting
  const metricInverseIconDisplay = data.metric.inverse ? (
    <Tooltip content="Metric is inverse, lower is better">
      <span>
        <MdSwapCalls />
      </span>
    </Tooltip>
  ) : null;

  // Handle quantile metrics if they exist on the metric
  let quantileMetric = false;
  let quantileIgnoreZeros = false;
  let quantileValue = 0.5;
  
  if (isFactMetric(data.metric)) {
    quantileMetric = data.metric.quantileSettings ? quantileMetricType(data.metric.metricType) : false;
    quantileIgnoreZeros = data.metric.quantileSettings?.ignoreZeros ?? false;
    quantileValue = data.metric.quantileSettings?.quantile ?? 0.5;
  }
  
  // Handle denominator formatting
  let hasCustomDenominator = false;
  let denomFormatter = formatNumber;
  
  if (isFactMetric(data.metric)) {
    hasCustomDenominator = !!data.metric.denominator && data.metric.denominator !== "count";
    if (hasCustomDenominator && data.metric.denominator) {
      denomFormatter = getColumnRefFormatter(data.metric.denominator, getFactTableById);
    }
  }

  const maybeRenderLiftWarning = () => {
    const cupedUsed = data.metricSnapshotSettings?.regressionAdjustmentEnabled;
    const priorUsed =
      data.statsEngine === "bayesian" &&
      data.metricSnapshotSettings?.properPrior;

    if (!data.rowResults.enoughData || (!priorUsed && !cupedUsed)) {
      return null;
    }

    return (
      <Callout size="sm" status="warning">
        {priorUsed && cupedUsed ? (
          <>CUPED and Bayesian Priors affect results</>
        ) : priorUsed ? (
          <>Bayesian Priors affect results</>
        ) : (
          <>CUPED affect results</>
        )}{" "}
        <Tooltip
          content={
            <Flex direction="column" gap="1">
              {priorUsed ? (
                <span>
                  {`This metric was analyzed with a prior that is normally distributed with mean ${
                    data.metricSnapshotSettings?.properPriorMean ?? 0
                  } and standard deviation ${
                    data.metricSnapshotSettings?.properPriorStdDev ??
                    DEFAULT_PROPER_PRIOR_STDDEV
                  }.`}
                </span>
              ) : null}
              {cupedUsed ? (
                <span>
                  {`This metric was analyzed with CUPED, which adjusts for covariates.`}
                </span>
              ) : null}
              <span>
                {`This affects metrics results (e.g., lift, ${
                  data.statsEngine === "bayesian"
                    ? "chance to win, credible intervals"
                    : "p-values, confidence intervals"
                }), and estimated lift will often differ from the raw difference between variation and baseline.`}
              </span>
            </Flex>
          }
        >
          <span>
            <PiInfo size={16} />
          </span>
        </Tooltip>
      </Callout>
    );
  };

  const maybeRenderSuspiciousChange = () => {
    if (data.isGuardrail || !data.rowResults.suspiciousChange) {
      return null;
    }

    return (
      <Callout size="sm" status="info">
        A suspicious change was detected in this metric.{" "}
        <Tooltip content={data.rowResults.suspiciousChangeReason}>
          <span>
            <PiInfo size={16} />
          </span>
        </Tooltip>
      </Callout>
    );
  };



  return (
    <div
      ref={popoverRef}
      className="analysis-result-popover"
      style={{
        position: 'absolute',
        top: `${position.top}px`,
        left: `${position.left}px`,
        zIndex: 1000,
        backgroundColor: 'white',
        borderRadius: '4px',
        boxShadow: '0 2px 10px rgba(0, 0, 0, 0.1)',
        maxWidth: '500px',
        minWidth: '300px',
        padding: '16px',
      }}
    >
      <Box p="1">
        <Flex direction="column" gap="2" mb="3">
          <Flex gap="1" align="center">
            <Text weight="medium" size="2">
              {data.metric.name}
            </Text>
            <PercentileLabel metric={data.metric} />
            <Text weight="regular">
              ({isFactMetric(data.metric) ? data.metric.metricType : data.metric.type})
            </Text>
            {metricInverseIconDisplay}
            {data.dimensionValue && (
              <Text>{data.dimensionValue}</Text>
            )}
          </Flex>
        </Flex>

        <Flex align="center" gap="2">
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
            }}
          >
            {data.variation.index}
          </span>
          <Text weight="bold">{data.variation.name}</Text>
        </Flex>
      </Flex>

      <Box mb="4">
        <FlagCard
          effectLabel={effectLabel}
          deltaFormatter={deltaFormatter}
          deltaFormatterOptions={deltaFormatterOptions}
          pValueThreshold={pValueThreshold}
          data={data}
        />
      </Box>

      <Table size="1">
        <TableHeader>
          <TableRow style={{ color: "var(--color-text-mid)" }}>
            <TableColumnHeader pl="0">Variation</TableColumnHeader>
            <TableColumnHeader justify="end">
              {quantileMetric && quantileIgnoreZeros ? "Non-zero " : ""}
              {quantileMetric === "event" ? "Events" : "Units"}
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
              i === 0 ? data?.baselineVariation.index : data.variation.index;
            const rowName =
              i === 0 ? data.baselineVariation.name : data.variation.name;
            const variationColor = getVariationColor(rowNumber, true);
            return (
              <TableRow
                key={`result_popover_row_${i}`}
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
                      <Text weight="bold">{rowName}</Text>
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
                    {getExperimentMetricFormatter(
                      data.metric,
                      ssrPolyfills?.getFactTableById || getFactTableById,
                      "number"
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

      <Flex direction="column" gap="2">
        {maybeRenderLiftWarning()}
        {maybeRenderSuspiciousChange()}
      </Flex>
    </Box>
  </div>
);
}
