import { useMemo } from "react";
import { Box, Flex } from "@radix-ui/themes";
import type { ExplorationConfig } from "shared/validators";
import { useDefinitions } from "@/services/DefinitionsContext";
import ComparisonTrendLabel from "@/enterprise/components/ProductAnalytics/ComparisonTrendLabel";
import { useExplorerContext } from "@/enterprise/components/ProductAnalytics/ExplorerContext";
import {
  computePeriodSummary,
  showsComparisonOverview,
} from "@/enterprise/components/ProductAnalytics/compareUtil";
import { formatCompactNumber } from "@/enterprise/components/ProductAnalytics/util";
import Callout from "@/ui/Callout";
import HelperText from "@/ui/HelperText";
import Text from "@/ui/Text";

export default function ComparisonSummary({
  submittedExploreState,
}: {
  submittedExploreState: ExplorationConfig;
}) {
  const {
    compareEnabled,
    exploration,
    comparisonExploration,
    comparisonLoading,
    comparisonError,
  } = useExplorerContext();
  const { getFactMetricById } = useDefinitions();

  const summaries = useMemo(
    () =>
      computePeriodSummary(
        exploration,
        comparisonExploration,
        submittedExploreState,
        getFactMetricById,
      ),
    [
      exploration,
      comparisonExploration,
      submittedExploreState,
      getFactMetricById,
    ],
  );

  if (
    !compareEnabled ||
    !showsComparisonOverview(submittedExploreState.chartType)
  ) {
    return null;
  }

  return (
    <Flex
      direction="column"
      style={{
        border: "1px solid var(--gray-a3)",
        borderRadius: "var(--radius-4)",
        boxShadow: "var(--shadow-2)",
      }}
    >
      <Box px="4" pt="4" pb="2">
        <Text size="medium" weight="semibold">
          Overview
        </Text>
      </Box>

      <Flex direction="column" gap="2" px="4" pb="4">
        {comparisonLoading ? (
          <HelperText status="info">Loading comparison period...</HelperText>
        ) : null}

        {comparisonError ? (
          <Callout status="error">{comparisonError}</Callout>
        ) : null}

        {!comparisonLoading && summaries.length > 0 ? (
          <Flex direction="column" gap="2">
            {summaries.map((summary) => {
              const label = summary.groupKey
                ? `${summary.metricName} (${summary.groupKey})`
                : summary.metricName;

              return (
                <Flex
                  key={`${summary.metricId}-${summary.groupKey}`}
                  align="center"
                  justify="between"
                  gap="3"
                  wrap="wrap"
                >
                  <Text size="small" color="text-mid">
                    {label}
                  </Text>
                  <Flex align="center" gap="2" wrap="wrap">
                    <Text size="medium" weight="semibold">
                      {formatCompactNumber(summary.totalTrend.current)}
                    </Text>
                    <ComparisonTrendLabel trend={summary.totalTrend} />
                    {summary.averageTrend && summary.averageLabel ? (
                      <Flex align="center" gap="2" wrap="wrap">
                        <Text size="small" color="text-mid">
                          Avg per {summary.averageLabel}:{" "}
                          {formatCompactNumber(summary.averageTrend.current)}
                        </Text>
                        <ComparisonTrendLabel trend={summary.averageTrend} />
                      </Flex>
                    ) : null}
                  </Flex>
                </Flex>
              );
            })}
          </Flex>
        ) : null}
      </Flex>
    </Flex>
  );
}
