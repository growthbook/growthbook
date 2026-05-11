import { useMemo } from "react";
import { Flex } from "@radix-ui/themes";
import type { ExplorationConfig } from "shared/validators";
import { useDefinitions } from "@/services/DefinitionsContext";
import ComparisonTrendLabel from "@/enterprise/components/ProductAnalytics/ComparisonTrendLabel";
import { useExplorerContext } from "@/enterprise/components/ProductAnalytics/ExplorerContext";
import { computePeriodSummary } from "@/enterprise/components/ProductAnalytics/compareUtil";
import Callout from "@/ui/Callout";
import HelperText from "@/ui/HelperText";
import Text from "@/ui/Text";

function formatTotal(value: number): string {
  if (Math.abs(value) >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(2)}M`;
  }
  if (Math.abs(value) >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

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

  if (!compareEnabled) {
    return null;
  }

  return (
    <Flex direction="column" gap="2" px="1">
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
                    {formatTotal(summary.totalTrend.current)}
                  </Text>
                  <ComparisonTrendLabel trend={summary.totalTrend} />
                  {summary.averageTrend && summary.averageLabel ? (
                    <Flex align="center" gap="2" wrap="wrap">
                      <Text size="small" color="text-mid">
                        Avg per {summary.averageLabel}:{" "}
                        {formatTotal(summary.averageTrend.current)}
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
  );
}
