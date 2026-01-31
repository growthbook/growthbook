import clsx from "clsx";
import { Flex } from "@radix-ui/themes";
import { SnapshotMetric } from "shared/types/experiment-snapshot";
import { FaArrowDown, FaArrowUp } from "react-icons/fa";
import React, { DetailedHTMLProps, TdHTMLAttributes } from "react";
import { DifferenceType, StatsEngine } from "shared/types/stats";
import { ExperimentMetricInterface } from "shared/experiments";
import { RowResults } from "@/services/experiments";
import {
  formatPercent,
  getExperimentMetricFormatter,
} from "@/services/metrics";
import { useCurrency } from "@/hooks/useCurrency";
import { useDefinitions } from "@/services/DefinitionsContext";
import { SSRPolyfills } from "@/hooks/useSSRPolyfills";
import { useResultPopover } from "./useResultPopover";

interface Props
  extends DetailedHTMLProps<
    TdHTMLAttributes<HTMLTableCellElement>,
    HTMLTableCellElement
  > {
  metric: ExperimentMetricInterface;
  stats: SnapshotMetric;
  rowResults: Pick<
    RowResults,
    | "directionalStatus"
    | "enoughData"
    | "hasScaledImpact"
    | "resultsStatus"
    | "significant"
    | "suspiciousChange"
    | "minPercentChange"
  >;
  statsEngine: StatsEngine;
  showPlusMinus?: boolean;
  differenceType: DifferenceType;
  showCI?: boolean;
  className?: string;
  ssrPolyfills?: SSRPolyfills;
  additionalButton?: React.ReactNode;
  minSampleSize?: number;
}

export default function ChangeColumn({
  metric,
  stats,
  rowResults,
  statsEngine,
  showPlusMinus = true,
  showCI = false,
  differenceType,
  className,
  ssrPolyfills,
  additionalButton,
  minSampleSize = 0,
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

  const { handleMouseEnter, handleMouseMove, handleMouseLeave, renderPopover } =
    useResultPopover({
      enabled: showPopover,
      positioning: "element",
      data: {
        stats,
        metric,
        significant: rowResults.significant,
        resultsStatus: rowResults.resultsStatus,
        differenceType,
        statsEngine,
        ssrPolyfills,
        suspiciousChange: rowResults.suspiciousChange,
        notEnoughData: !rowResults.enoughData,
        minSampleSize,
        minPercentChange: rowResults.minPercentChange,
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

  return (
    <>
      {metric && rowResults.enoughData ? (
        <td className={clsx("results-change", className)} {...otherProps}>
          <Flex align="center" justify="end" gap="2">
            <span
              onMouseEnter={handleMouseEnter}
              onMouseMove={handleMouseMove}
              onMouseLeave={handleMouseLeave}
            >
              {changeContent}
            </span>
            {additionalButton}
          </Flex>
        </td>
      ) : (
        <td />
      )}
      {renderPopover()}
    </>
  );
}
