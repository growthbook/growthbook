import { useMemo } from "react";
import { Flex, Grid } from "@radix-ui/themes";
import type { ExplorationConfig } from "shared/validators";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useExplorerContext } from "@/enterprise/components/ProductAnalytics/ExplorerContext";
import {
  computeBucketComparisons,
  computePeriodTotals,
} from "@/enterprise/components/ProductAnalytics/compareUtil";
import Badge from "@/ui/Badge";
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

function getTrendColor(delta: number): "green" | "red" | "gray" {
  if (delta > 0) return "green";
  if (delta < 0) return "red";
  return "gray";
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

  const periodTotals = useMemo(
    () =>
      computePeriodTotals(
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

  const bucketComparisons = useMemo(
    () =>
      computeBucketComparisons(
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
    <Flex
      direction="column"
      gap="3"
      p="3"
      style={{
        border: "1px solid var(--gray-a3)",
        borderRadius: "var(--radius-4)",
      }}
    >
      <Flex direction="column" gap="1">
        <Text weight="medium">Comparison summary</Text>
        <HelperText status="info">
          Current period vs the immediately previous period.
        </HelperText>
      </Flex>

      {comparisonLoading ? (
        <HelperText status="info">Loading comparison period...</HelperText>
      ) : null}

      {comparisonError ? (
        <Callout status="error">{comparisonError}</Callout>
      ) : null}

      {!comparisonLoading && periodTotals.length > 0 ? (
        <Grid columns="3" gap="3" width="100%">
          {periodTotals.map((total) => {
            const label = total.groupKey
              ? `${total.metricName} (${total.groupKey})`
              : total.metricName;

            return (
              <Flex
                key={`${total.metricId}-${total.groupKey}`}
                direction="column"
                gap="1"
                p="3"
                style={{
                  border: "1px solid var(--gray-a4)",
                  borderRadius: "var(--radius-3)",
                }}
              >
                <Text size="small" color="text-mid">
                  {label}
                </Text>
                <Text size="large" weight="semibold">
                  {formatTotal(total.currentTotal)}
                </Text>
                <Flex align="center" gap="2" wrap="wrap">
                  <Text size="small" color="text-mid">
                    vs {formatTotal(total.previousTotal)}
                  </Text>
                  {total.percentChange ? (
                    <Badge
                      color={getTrendColor(total.delta)}
                      label={total.percentChange}
                    />
                  ) : (
                    <HelperText status="info">
                      No prior-period baseline
                    </HelperText>
                  )}
                </Flex>
              </Flex>
            );
          })}
        </Grid>
      ) : null}

      {!comparisonLoading && bucketComparisons.length > 0 ? (
        <Flex direction="column" gap="2">
          <Text size="small" weight="medium">
            Trend by bucket
          </Text>
          <Flex direction="column" gap="2">
            {bucketComparisons.map((bucket, index) => {
              const label = bucket.groupKey
                ? `${bucket.bucketLabel} · ${bucket.metricName} (${bucket.groupKey})`
                : `${bucket.bucketLabel} · ${bucket.metricName}`;

              return (
                <Flex
                  key={`${bucket.metricId}-${bucket.groupKey}-${bucket.bucketLabel}-${index}`}
                  justify="between"
                  align="center"
                  gap="3"
                  wrap="wrap"
                >
                  <Text size="small">{label}</Text>
                  <Flex align="center" gap="2">
                    <Text size="small" weight="medium">
                      {formatTotal(bucket.currentTotal)}
                    </Text>
                    <Text size="small" color="text-mid">
                      vs {formatTotal(bucket.previousTotal)}
                    </Text>
                    {bucket.percentChange ? (
                      <Badge
                        color={getTrendColor(bucket.delta)}
                        label={bucket.percentChange}
                      />
                    ) : null}
                  </Flex>
                </Flex>
              );
            })}
          </Flex>
        </Flex>
      ) : null}
    </Flex>
  );
}
