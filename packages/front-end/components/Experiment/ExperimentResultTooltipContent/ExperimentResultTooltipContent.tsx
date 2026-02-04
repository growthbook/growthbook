import React from "react";
import clsx from "clsx";
import { formatDistance } from "date-fns";
import { PiWarningCircle } from "react-icons/pi";
import { Box, Flex, Text } from "@radix-ui/themes";
import { DifferenceType, StatsEngine } from "shared/types/stats";
import { SnapshotMetric } from "shared/types/experiment-snapshot";
import { ExperimentMetricInterface, isFactMetric } from "shared/experiments";
import { SSRPolyfills } from "@/hooks/useSSRPolyfills";
import { useCurrency } from "@/hooks/useCurrency";
import { useDefinitions } from "@/services/DefinitionsContext";
import useConfidenceLevels from "@/hooks/useConfidenceLevels";
import { RowResults } from "@/services/experiments";
import {
  formatPercent,
  getColumnRefFormatter,
  getExperimentMetricFormatter,
  getMetricFormatter,
} from "@/services/metrics";
import styles from "./ExperimentResultTooltipContent.module.scss";

interface ExperimentResultTooltipContentProps {
  stats: SnapshotMetric;
  metric: ExperimentMetricInterface;
  significant: boolean;
  resultsStatus: RowResults["resultsStatus"];
  differenceType: DifferenceType;
  statsEngine: StatsEngine;
  ssrPolyfills?: SSRPolyfills;
  suspiciousChange: boolean;
  suspiciousThreshold: number;
  notEnoughData: boolean;
  minSampleSize: number;
  minPercentChange: number;
  currentMetricTotal: number;
  timeRemainingMs?: number;
}

export default function ExperimentResultTooltipContent({
  stats,
  metric,
  significant,
  resultsStatus,
  differenceType,
  statsEngine,
  ssrPolyfills,
  suspiciousChange,
  suspiciousThreshold,
  notEnoughData,
  minSampleSize,
  minPercentChange,
  currentMetricTotal,
  timeRemainingMs,
}: ExperimentResultTooltipContentProps) {
  const _displayCurrency = useCurrency();
  const displayCurrency = ssrPolyfills?.useCurrency?.() || _displayCurrency;

  const { getFactTableById: _getFactTableById } = useDefinitions();
  const getFactTableById = ssrPolyfills?.getFactTableById || _getFactTableById;

  const _confidenceLevels = useConfidenceLevels();
  const { ciUpperDisplay } =
    ssrPolyfills?.useConfidenceLevels() || _confidenceLevels;

  const ci = stats?.ciAdjusted ?? stats?.ci;

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

  const percentFormatter = new Intl.NumberFormat(undefined, {
    style: "percent",
    maximumFractionDigits: 2,
  });

  // Formatter for numerator values (minSampleSize, currentMetricTotal)
  // Uses metric-specific formatting (e.g., currency for revenue metrics)
  const numeratorFormatter = isFactMetric(metric)
    ? getColumnRefFormatter(metric.numerator, getFactTableById)
    : getMetricFormatter(metric.type === "binomial" ? "count" : metric.type);

  const ciLabel =
    statsEngine === "bayesian" ? "95% CI" : `${ciUpperDisplay} CI`;

  const isWon = significant && resultsStatus === "won";
  const isLost = significant && resultsStatus === "lost";
  const showWarningIcon =
    notEnoughData || suspiciousChange || resultsStatus === "draw";

  const getBadgeText = () => {
    if (notEnoughData) return "Not enough data";
    if (significant) {
      if (resultsStatus === "won") return "Won";
      if (resultsStatus === "lost") return "Lost";
      if (resultsStatus === "draw") return "Draw";
    }
    return "Insignificant";
  };

  const renderBadge = () => (
    <Flex
      className={clsx(styles.badge, {
        [styles.badgeWon]: isWon,
        [styles.badgeLost]: isLost,
      })}
      px="4"
      py="2px"
      align="center"
      justify="between"
      gap="1"
    >
      <Text size="1" weight="bold">
        {getBadgeText()}
      </Text>
      {showWarningIcon && (
        <PiWarningCircle size={15} style={{ color: "var(--gray-contrast)" }} />
      )}
    </Flex>
  );

  const renderNotEnoughDataContent = () => (
    <Flex direction="column" gap="1">
      <Text size="1" style={{ color: "var(--color-text-high)" }}>
        Minimum{" "}
        {numeratorFormatter(minSampleSize, { currency: displayCurrency })} not
        met
      </Text>
      <Text size="1" style={{ color: "var(--color-text-mid)" }}>
        Current metric total is{" "}
        {numeratorFormatter(currentMetricTotal, {
          currency: displayCurrency,
        })}
        {timeRemainingMs !== undefined && (
          <>
            <br />
            {timeRemainingMs > 0 ? (
              <>About {formatDistance(0, timeRemainingMs)} remaining</>
            ) : (
              "Try updating now"
            )}
          </>
        )}
      </Text>
    </Flex>
  );

  const maybeRenderDrawDescription = () => {
    if (resultsStatus !== "draw" || minPercentChange === undefined) return null;
    return (
      <Text as="div" size="1" style={{ color: "var(--color-text-mid)" }}>
        <b>Draw:</b> this occurs when the % Change is smaller than the
        metric&apos;s min change ({percentFormatter.format(minPercentChange)})
      </Text>
    );
  };

  const maybeRenderSuspiciousDescription = () => {
    if (!suspiciousChange) return null;
    return (
      <Text as="div" size="1" style={{ color: "var(--color-text-mid)" }}>
        <b>Suspicious:</b> this occurs when the % Change is above the
        metric&apos;s max change ({percentFormatter.format(suspiciousThreshold)}
        )
      </Text>
    );
  };

  const renderResultContent = () => (
    <Flex direction="column" gap="1">
      <Flex align="center" justify="between" gap="1">
        <Text
          size="1"
          weight="medium"
          style={{ color: "var(--color-text-high)" }}
        >
          {ciLabel}
        </Text>
        <Text
          size="1"
          weight="medium"
          style={{ color: "var(--color-text-high)" }}
        >
          {ci ? (
            <>
              [{formatter(ci[0], formatterOptions)},{" "}
              {formatter(ci[1], formatterOptions)}]
            </>
          ) : (
            "Unknown"
          )}
        </Text>
      </Flex>
      {maybeRenderDrawDescription()}
      {maybeRenderSuspiciousDescription()}
    </Flex>
  );

  return (
    <Flex direction="column" width="220px">
      {renderBadge()}
      <Box px="4" py="2">
        {notEnoughData ? renderNotEnoughDataContent() : renderResultContent()}
      </Box>
    </Flex>
  );
}
