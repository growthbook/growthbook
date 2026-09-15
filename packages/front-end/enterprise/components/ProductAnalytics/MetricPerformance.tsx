import { useMemo } from "react";
import { Flex } from "@radix-ui/themes";
import { FactMetricInterface } from "shared/types/fact-table";
import {
  ExplorationConfig,
  draftExplorationMetricValidator,
} from "shared/validators";
import { DEFAULT_EXPLORE_STATE } from "shared/enterprise";
import { isFactFunnelMetric } from "shared/experiments";
import { datetime } from "shared/dates";
import {
  deriveFunnelUnit,
  funnelSettingsToFunnelDataset,
} from "shared/funnels";
import {
  DefinitionsContext,
  useDefinitions,
} from "@/services/DefinitionsContext";
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
  const timeSeries =
    draftExploreState.chartType === "bar" &&
    draftExploreState.dimensions.some(
      (dimension) => dimension.dimensionType === "date",
    );
  return (
    <Flex direction="column" gap="2" minHeight="0">
      <Text size="sm" color="text-mid">
        Last 7 days
      </Text>
      <ExplorerChart
        compact
        exploration={exploration}
        submittedExploreState={submittedExploreState ?? draftExploreState}
        loading={loading}
        error={error}
      />
      {timeSeries && (
        <Text size="sm" color="text-mid">
          Daily metric values (UTC). Today is partial.
        </Text>
      )}
      {exploration?.status === "success" && (
        <Flex direction="column" gap="1">
          <Text size="sm" color="text-mid">
            Last queried:{" "}
            {datetime(exploration.runStarted ?? exploration.dateCreated)}
          </Text>
          <Text size="sm" color="text-mid">
            Newer data may be available. Refresh to update.
          </Text>
        </Flex>
      )}
      <Button
        size="sm"
        variant="soft"
        disabled={loading || !isSubmittable}
        onClick={() => handleSubmit({ force: true })}
      >
        Refresh
      </Button>
    </Flex>
  );
}

export default function MetricPerformance({
  metric,
  draft = false,
}: {
  metric: FactMetricInterface;
  draft?: boolean;
}) {
  const definitions = useDefinitions();
  const { getFactTableById, getDatasourceById } = definitions;
  const previewDefinitions = useMemo(
    () => ({
      ...definitions,
      getFactMetricById: (id: string) =>
        draft && id === metric.id ? metric : definitions.getFactMetricById(id),
    }),
    [definitions, draft, metric],
  );
  const permissions = usePermissionsUtil();
  const datasource = getDatasourceById(metric.datasource);
  if (!datasource || !permissions.canRunMetricQueries(datasource)) {
    return (
      <Text color="text-mid">
        You don’t have permission to load this metric’s performance.
      </Text>
    );
  }
  if (
    draft &&
    (metric.metricType === "proportion" ||
      metric.metricType === "retention" ||
      metric.metricType === "dailyParticipation")
  ) {
    return (
      <Text color="text-mid">
        Calculating this rate requires an eligible user population. A source
        activity count would not represent this metric.
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
        chartType: timeSeries ? "bar" : "bigNumber",
        showAs: "per_unit",
        dataset: {
          type: "metric",
          values: [
            {
              type: "metric",
              metricId: metric.id,
              ...(draft
                ? {
                    draftMetric: draftExplorationMetricValidator
                      .strip()
                      .parse(metric),
                  }
                : {}),
              name: metric.name,
              rowFilters: [],
              unit: null,
              denominatorUnit: null,
            },
          ],
        },
      };
  return (
    <DefinitionsContext.Provider value={previewDefinitions}>
      <ExplorerProvider initialConfig={config} trackingSource="metric-preview">
        <PerformanceChart />
      </ExplorerProvider>
    </DefinitionsContext.Provider>
  );
}
