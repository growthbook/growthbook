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
import {
  formatPercent,
  getExperimentMetricFormatter,
} from "@/services/metrics";
import styles from "./ExperimentResultTooltipContent.module.scss";

export type ResultStatus = "won" | "lost" | "draw" | "";

interface ExperimentResultTooltipContentProps {
  stats: SnapshotMetric;
  metric: ExperimentMetricInterface;
  significant: boolean;
  resultsStatus: ResultStatus;
  differenceType: DifferenceType;
  statsEngine: StatsEngine;
  ssrPolyfills?: SSRPolyfills;
}

export default function ExperimentResultTooltipContent({
  stats,
  metric,
  significant,
  resultsStatus,
  differenceType,
  statsEngine,
  ssrPolyfills,
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

  const ciLabel =
    statsEngine === "bayesian" ? "95% CI" : `${ciUpperDisplay} CI`;

  const getBadgeText = () => {
    if (significant) {
      return resultsStatus === "won" ? "WON" : "LOST";
    }
    return "INSIGNIFICANT";
  };

  const isWon = significant && resultsStatus === "won";
  const isLost = significant && resultsStatus === "lost";

  return (
    <Flex direction="column" minWidth="200px">
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

      <Box px="4">
        <Flex align="center" justify="between" gap="1" my="2">
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
      </Box>
    </Flex>
  );
}
