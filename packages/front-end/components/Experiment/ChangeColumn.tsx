import clsx from "clsx";
import { Flex } from "@radix-ui/themes";
import { SnapshotMetric } from "shared/types/experiment-snapshot";
import { FaArrowDown, FaArrowUp } from "react-icons/fa";
import { PiInfo } from "react-icons/pi";
import React, { DetailedHTMLProps, TdHTMLAttributes } from "react";
import { DifferenceType, StatsEngine } from "shared/types/stats";
import { ExperimentMetricDefinition } from "shared/experiments";
import { MetricSnapshotSettings } from "shared/types/report";
import { RowResults } from "@/services/experiments";
import {
  formatPercent,
  getExperimentMetricFormatter,
} from "@/services/metrics";
import { useCurrency } from "@/hooks/useCurrency";
import { useDefinitions } from "@/services/DefinitionsContext";
import { SSRPolyfills } from "@/hooks/useSSRPolyfills";
import Tooltip from "@/ui/Tooltip";
import { useResultPopover } from "./useResultPopover";

interface Props
  extends DetailedHTMLProps<
    TdHTMLAttributes<HTMLTableCellElement>,
    HTMLTableCellElement
  > {
  metric: ExperimentMetricDefinition;
  pValueThreshold: number;
  stats: SnapshotMetric;
  rowResults: Pick<
    RowResults,
    | "directionalStatus"
    | "enoughData"
    | "hasScaledImpact"
    | "resultsStatus"
    | "significant"
    | "suspiciousChange"
    | "suspiciousThreshold"
    | "minPercentChange"
    | "currentMetricTotal"
  >;
  statsEngine: StatsEngine;
  showPlusMinus?: boolean;
  differenceType: DifferenceType;
  showCI?: boolean;
  className?: string;
  ssrPolyfills?: SSRPolyfills;
  additionalButton?: React.ReactNode;
  minSampleSize?: number;
  pValueAdjustmentEnabled?: boolean;
  metricSnapshotSettings?: MetricSnapshotSettings;
}

/** Join adjustment names into a readable list ("a, b, and c"). */
function formatAdjustmentList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

export default function ChangeColumn({
  metric,
  pValueThreshold,
  stats,
  rowResults,
  statsEngine,
  showPlusMinus = false,
  showCI = false,
  differenceType,
  className,
  ssrPolyfills,
  additionalButton,
  minSampleSize = 0,
  pValueAdjustmentEnabled,
  metricSnapshotSettings,
  ...otherProps
}: Props) {
  const _displayCurrency = useCurrency();
  const { getFactTableById: _getFactTableById } = useDefinitions();

  const getFactTableById = ssrPolyfills?.getFactTableById || _getFactTableById;
  const displayCurrency = ssrPolyfills?.useCurrency() || _displayCurrency;

  const expected = stats?.expected ?? 0;
  const ci0 = stats?.ciAdjusted?.[0] ?? stats?.ci?.[0] ?? 0;
  const ci1 = stats?.ciAdjusted?.[1] ?? stats?.ci?.[1] ?? 0;

  const formatter =
    differenceType === "relative"
      ? formatPercent
      : getExperimentMetricFormatter(
          metric,
          getFactTableById,
          differenceType === "absolute" ? "percentagePoints" : "number",
        );
  const formatterOptions: Intl.NumberFormatOptions = {
    currency: displayCurrency,
    ...(differenceType === "relative" ? { maximumFractionDigits: 1 } : {}),
    ...(differenceType === "scaled" ? { notation: "compact" } : {}),
  };
  const showPopover = !!stats?.ci;

  const { Trigger } = useResultPopover({
    enabled: showPopover,
    positioning: "element",
    data: {
      stats,
      metric,
      pValueThreshold,
      significant: rowResults.significant,
      resultsStatus: rowResults.resultsStatus,
      differenceType,
      statsEngine,
      ssrPolyfills,
      suspiciousChange: rowResults.suspiciousChange,
      suspiciousThreshold: rowResults.suspiciousThreshold,
      notEnoughData: !rowResults.enoughData,
      minSampleSize,
      minPercentChange: rowResults.minPercentChange,
      currentMetricTotal: rowResults.currentMetricTotal,
      pValueAdjustmentEnabled,
    },
  });

  if (!rowResults.hasScaledImpact && differenceType === "scaled") {
    return null;
  }

  const changeContent = (
    <div
      className={clsx("nowrap change", {
        "text-left": showCI,
        "text-right": !showCI,
      })}
    >
      <span className="expectedArrows">
        {(rowResults.directionalStatus === "winning" && !metric.inverse) ||
        (rowResults.directionalStatus === "losing" && metric.inverse) ? (
          <FaArrowUp />
        ) : expected !== 0 ? (
          <FaArrowDown />
        ) : null}
      </span>{" "}
      {expected === 0 && stats.errorMessage ? (
        <span className="expected">n/a</span>
      ) : (
        <span className="expected">
          {formatter(expected, formatterOptions)}{" "}
        </span>
      )}
      {statsEngine === "frequentist" && showPlusMinus ? (
        <span className="plusminus font-weight-normal text-gray ml-1">
          ±
          {Math.abs(ci0) === Infinity || Math.abs(ci1) === Infinity ? (
            <span style={{ fontSize: "18px", verticalAlign: "-2px" }}>∞</span>
          ) : (
            formatter(expected - ci0, formatterOptions)
          )}
        </span>
      ) : null}
      {showCI ? (
        <span className="ml-2 ci font-weight-normal text-gray">
          [{formatter(ci0, formatterOptions)},{" "}
          {formatter(ci1, formatterOptions)}]
        </span>
      ) : null}
    </div>
  );

  const priorUsed =
    statsEngine === "bayesian" && !!metricSnapshotSettings?.properPrior;
  const cupedUsed = !!metricSnapshotSettings?.regressionAdjustmentEnabled;
  const postStratificationUsed =
    !!stats?.realizedSettings?.postStratificationApplied;

  const adjustmentLabels: string[] = [];
  if (priorUsed) adjustmentLabels.push("a Bayesian prior");
  if (cupedUsed) adjustmentLabels.push("CUPED");
  if (postStratificationUsed) adjustmentLabels.push("post-stratification");

  const adjustmentInfo =
    adjustmentLabels.length > 0 ? (
      <Tooltip
        content={`This estimate is affected by usage of ${formatAdjustmentList(
          adjustmentLabels,
        )}.`}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            color: "var(--color-text-low)",
            cursor: "help",
          }}
        >
          <PiInfo size={15} />
        </span>
      </Tooltip>
    ) : null;

  if (!metric) {
    return <td {...otherProps} />;
  }

  if (!rowResults.enoughData) {
    if (!additionalButton) {
      return <td {...otherProps} />;
    }
    return (
      <td className={clsx("results-change", className)} {...otherProps}>
        <Flex align="center" justify="end" gap="2">
          {additionalButton}
        </Flex>
      </td>
    );
  }

  return (
    <td className={clsx("results-change", className)} {...otherProps}>
      <Flex align="center" justify="end" gap="2">
        <Trigger>{changeContent}</Trigger>
        {adjustmentInfo}
        {additionalButton}
      </Flex>
    </td>
  );
}
