import { useCallback, useEffect, useMemo, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { DEFAULT_EXPLORE_STATE } from "shared/enterprise";
import { FactMetricInterface } from "shared/types/fact-table";
import {
  ExplorationConfig,
  ProductAnalyticsExploration,
} from "shared/validators";
import Button from "@/ui/Button";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import LoadingSpinner from "@/components/LoadingSpinner";
import ExplorerChart from "@/enterprise/components/ProductAnalytics/MainSection/ExplorerChart";
import {
  CacheOption,
  useExploreData,
} from "@/enterprise/components/ProductAnalytics/useExploreData";

export default function MetricExplorationPreview({
  factMetric,
  defaultUnit,
}: {
  factMetric: FactMetricInterface;
  defaultUnit: string | null;
}) {
  const { loading, fetchData } = useExploreData();
  const [exploration, setExploration] =
    useState<ProductAnalyticsExploration | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checkingCache, setCheckingCache] = useState(true);

  const config = useMemo<ExplorationConfig>(
    () => ({
      ...DEFAULT_EXPLORE_STATE,
      type: "metric",
      datasource: factMetric.datasource,
      dataset: {
        type: "metric",
        values: [
          {
            type: "metric",
            metricId: factMetric.id,
            name: factMetric.name,
            unit: defaultUnit,
            denominatorUnit: null,
            rowFilters: [],
          },
        ],
      },
    }),
    [defaultUnit, factMetric.datasource, factMetric.id, factMetric.name],
  );

  const loadPreview = useCallback(
    async (cache: CacheOption) => {
      const result = await fetchData(config, { cache });
      setExploration(result.data);
      setError(result.error);
      setCheckingCache(false);
    },
    [config, fetchData],
  );

  useEffect(() => {
    void loadPreview("required");
  }, [loadPreview]);

  const cacheMiss = !checkingCache && !loading && !exploration && !error;

  return (
    <Frame mb="4" p="4">
      <Flex align="center" justify="between" gap="3" mb="3">
        <Box>
          <Heading as="h2" size="medium" mb="0">
            Metric Trend
          </Heading>
          <Text size="small" color="text-low">
            Last 30 days
          </Text>
        </Box>
      </Flex>

      <Flex
        align="center"
        justify="center"
        direction="column"
        gap="3"
        style={{ height: 260, minHeight: 260 }}
      >
        {checkingCache ? (
          <LoadingSpinner />
        ) : cacheMiss ? (
          <>
            <Text color="text-mid">No recent preview is cached.</Text>
            <Button
              variant="outline"
              onClick={() => void loadPreview("preferred")}
            >
              Load preview
            </Button>
          </>
        ) : (
          <ExplorerChart
            exploration={exploration}
            error={error}
            submittedExploreState={config}
            loading={loading}
          />
        )}
      </Flex>
    </Frame>
  );
}
