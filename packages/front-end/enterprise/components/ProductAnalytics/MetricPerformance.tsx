import { Flex } from "@radix-ui/themes";
import { FactMetricInterface } from "shared/types/fact-table";
import { ExplorationConfig } from "shared/validators";
import { DEFAULT_EXPLORE_STATE } from "shared/enterprise";
import { isFactFunnelMetric } from "shared/experiments";
import {
  deriveFunnelUnit,
  funnelSettingsToFunnelDataset,
} from "shared/funnels";
import { useDefinitions } from "@/services/DefinitionsContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Text from "@/ui/Text";
import Button from "@/ui/Button";
import { ExplorerProvider, useExplorerContext } from "./ExplorerContext";
import ExplorerChart from "./MainSection/ExplorerChart";

function PerformanceChart() {
  const {
    exploration,
    submittedExploreState,
    draftExploreState,
    loading,
    error,
    isStale,
    isSubmittable,
    managedWarehouseUnavailable,
    handleSubmit,
  } = useExplorerContext();
  if (managedWarehouseUnavailable) {
    return (
      <Text color="text-mid">
        Metric performance will be available when the warehouse is ready.
      </Text>
    );
  }
  if (!loading && !isSubmittable) {
    return (
      <Text color="text-mid">
        Open this metric in Explorer to complete its required query settings.
      </Text>
    );
  }
  return (
    <Flex direction="column" gap="2" height="100%" minHeight="0">
      <Text size="sm" color="text-mid">
        Last 7 days
      </Text>
      <ExplorerChart
        exploration={exploration}
        submittedExploreState={submittedExploreState ?? draftExploreState}
        loading={loading}
        error={error}
      />
      {!loading && (isStale || error) && (
        <Button
          size="sm"
          variant="soft"
          disabled={!isSubmittable}
          onClick={() => handleSubmit({ force: true })}
        >
          Load performance
        </Button>
      )}
    </Flex>
  );
}

export default function MetricPerformance({
  metric,
}: {
  metric: FactMetricInterface;
}) {
  const { getFactTableById, getDatasourceById } = useDefinitions();
  const permissions = usePermissionsUtil();
  const datasource = getDatasourceById(metric.datasource);
  if (!datasource || !permissions.canRunMetricQueries(datasource)) {
    return (
      <Text color="text-mid">
        You don’t have permission to load this metric’s performance.
      </Text>
    );
  }
  const funnel = isFactFunnelMetric(metric);
  const timeSeries =
    !funnel &&
    (metric.metricType === "proportion" ||
      metric.metricType === "dailyParticipation" ||
      metric.numerator.column === "$$count");
  const config: ExplorationConfig = funnel
    ? {
        ...DEFAULT_EXPLORE_STATE,
        dateRange: {
          ...DEFAULT_EXPLORE_STATE.dateRange,
          predefined: "last7Days",
          lookbackValue: 7,
        },
        type: "funnel",
        datasource: metric.datasource,
        dimensions: [],
        chartType: "bar",
        dataset: funnelSettingsToFunnelDataset(
          metric.funnelSettings,
          deriveFunnelUnit({
            steps: metric.funnelSettings.steps,
            getFactTable: (id) => getFactTableById(id) ?? undefined,
          }),
        ),
      }
    : {
        ...DEFAULT_EXPLORE_STATE,
        dateRange: {
          ...DEFAULT_EXPLORE_STATE.dateRange,
          predefined: "last7Days",
          lookbackValue: 7,
        },
        type: "metric",
        datasource: metric.datasource,
        dimensions: timeSeries ? DEFAULT_EXPLORE_STATE.dimensions : [],
        chartType: timeSeries ? "line" : "bigNumber",
        showAs: "per_unit",
        dataset: {
          type: "metric",
          values: [
            {
              type: "metric",
              metricId: metric.id,
              name: metric.name,
              rowFilters: [],
              unit: null,
              denominatorUnit: null,
            },
          ],
        },
      };
  return (
    <ExplorerProvider initialConfig={config} trackingSource="metric-preview">
      <PerformanceChart />
    </ExplorerProvider>
  );
}
