import { useEffect, useMemo, useState } from "react";
import { Flex } from "@radix-ui/themes";
import { PiArrowClockwise } from "react-icons/pi";
import { FactMetricInterface } from "shared/types/fact-table";
import {
  ExplorationConfig,
  draftExplorationMetricValidator,
} from "shared/validators";
import { DEFAULT_EXPLORE_STATE } from "shared/enterprise";
import { isFactFunnelMetric } from "shared/experiments";
import { ago, datetime } from "shared/dates";
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
import { draftMetricNeedsPopulation } from "@/components/FactTables/MetricEditor/draftMetricPreview";
import Button from "@/ui/Button";
import { ExplorerProvider, useExplorerContext } from "./ExplorerContext";
import ExplorerChart from "./MainSection/ExplorerChart";

// Match the default dashboard stale interval.
const PREVIEW_STALE_AFTER_MS = 6 * 60 * 60 * 1000;

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
  const [now, setNow] = useState(() => Date.now());
  const lastQueried =
    exploration?.status === "success"
      ? (exploration.runStarted ?? exploration.dateCreated)
      : null;
  useEffect(() => {
    if (!lastQueried) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, [lastQueried]);
  const isStale =
    lastQueried !== null &&
    now - new Date(lastQueried).getTime() >= PREVIEW_STALE_AFTER_MS;

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
      {lastQueried && (
        <Flex
          align="center"
          gap="2"
          pb="3"
          mb="2"
          style={{ borderBottom: "1px solid var(--gray-a6)" }}
        >
          <Text size="sm" color={isStale ? undefined : "text-low"}>
            <span
              title={datetime(lastQueried)}
              style={isStale ? { color: "var(--amber-9)" } : undefined}
            >
              {isStale
                ? `Last queried: ${datetime(lastQueried)}`
                : `Updated ${ago(lastQueried)}`}
            </span>
          </Text>
          {!isStale && (
            <Button
              size="sm"
              variant="ghost"
              color="gray"
              aria-label="Refresh preview"
              title="Refresh preview"
              disabled={loading || !isSubmittable}
              onClick={() => handleSubmit({ force: true })}
            >
              <PiArrowClockwise size={14} />
            </Button>
          )}
        </Flex>
      )}
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
      {(isStale || !lastQueried || error) && (
        <Flex
          direction="column"
          gap="2"
          mt="2"
          pt="3"
          style={{ borderTop: "1px solid var(--gray-a6)" }}
        >
          {isStale && (
            <Text size="sm" color="text-mid">
              Newer data may be available. Refresh to update.
            </Text>
          )}
          <Button
            size="sm"
            disabled={loading || !isSubmittable}
            onClick={() => handleSubmit({ force: true })}
            icon={<PiArrowClockwise />}
          >
            {error || exploration?.status === "error" ? "Retry" : "Refresh"}
          </Button>
        </Flex>
      )}
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
  if (draft && draftMetricNeedsPopulation(metric.metricType)) {
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
