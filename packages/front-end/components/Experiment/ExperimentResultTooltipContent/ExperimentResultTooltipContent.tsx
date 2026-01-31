import React from "react";
import clsx from "clsx";
import { Box, Flex, Text } from "@radix-ui/themes";
import { DifferenceType, StatsEngine } from "shared/types/stats";
import { SnapshotMetric } from "shared/types/experiment-snapshot";
import { ExperimentMetricInterface } from "shared/experiments";
import { SSRPolyfills } from "@/hooks/useSSRPolyfills";
import { useCurrency } from "@/hooks/useCurrency";
import { useDefinitions } from "@/services/DefinitionsContext";
import useConfidenceLevels from "@/hooks/useConfidenceLevels";
import { RowResults } from "@/services/experiments";
import {
  formatPercent,
  getExperimentMetricFormatter,
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
  notEnoughData: boolean;
  minSampleSize: number;
  minPercentChange: number;
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
  notEnoughData,
  minSampleSize,
  minPercentChange,
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
    maximumFractionDigits: 0,
  });

  const ciLabel =
    statsEngine === "bayesian" ? "95% CI" : `${ciUpperDisplay} CI`;

  const getBadgeText = () => {
    if (notEnoughData) return "NOT ENOUGH DATA";
    if (significant) {
      if (resultsStatus === "won") return "WON";
      if (resultsStatus === "lost") return "LOST";
      if (resultsStatus === "draw") return "DRAW";
    }
    return "INSIGNIFICANT";
  };

  const isWon = significant && resultsStatus === "won";
  const isLost = significant && resultsStatus === "lost";

  console.log("minPercentChange", minPercentChange);
  console.log("suspiciousChange", suspiciousChange);

  return (
    <Flex direction="column" width="200px">
      <Box
        className={clsx(styles.badge, {
          [styles.badgeWon]: isWon,
          [styles.badgeLost]: isLost,
        })}
        pl="4"
      >
        <Text size="1" weight="bold">
          {getBadgeText()}
        </Text>
      </Box>

      <Box px="4" py="2">
        {notEnoughData ? (
          <Flex direction="column" gap="1">
            <Text size="1" style={{ color: "var(--color-text-high)" }}>
              {/* TODO: Format minSampleSize properly */}
              Minimum {minSampleSize} not met
            </Text>
            <Text size="1" style={{ color: "var(--color-text-mid)" }}>
              {/* TODO: Get the value from the proper place */}
              Current metric total is ...
              <br />
              {/* TODO: Get this from the proper place */}
              Estimated 3 days remaining
            </Text>
          </Flex>
        ) : (
          <>
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
            {resultsStatus === "draw" && minPercentChange !== undefined && (
              <Text size="1" style={{ color: "var(--color-text-mid)" }}>
                The % change is below the min. change threshold for a meaningful
                impact ({percentFormatter.format(minPercentChange)})
              </Text>
            )}
            {suspiciousChange && (
              <Text size="1" style={{ color: "var(--pink-a11)" }}>
                This is suspicious
              </Text>
            )}
          </>
        )}
      </Box>
    </Flex>
  );
}
