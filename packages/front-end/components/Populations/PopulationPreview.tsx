import { useMemo, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import {
  ApiPopulation,
  PopulationExplorationConfig,
  ProductAnalyticsExploration,
} from "shared/validators";
import { useDefinitions } from "@/services/DefinitionsContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { ExplorerProvider } from "@/enterprise/components/ProductAnalytics/ExplorerContext";
import DailyBarChart from "@/enterprise/components/ProductAnalytics/MainSection/DailyBarChart";
import PreviewHeadline from "@/enterprise/components/ProductAnalytics/MainSection/PreviewHeadline";
import PreviewShell from "@/enterprise/components/ProductAnalytics/MainSection/PreviewShell";
import PreviewUnitSelect from "@/enterprise/components/ProductAnalytics/MainSection/PreviewUnitSelect";
import {
  getMetricPreviewDateRange,
  formatPreviewHeadline,
} from "@/components/FactTables/MetricEditor/metricPreview";
import { getActivityChart } from "@/components/FactTables/MetricEditor/activityChart";
import LoadingSpinner from "@/components/LoadingSpinner";
import Callout from "@/ui/Callout";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";

// Daily distinct members for one population. Errors are shown by the shell.
function MembersChart({
  exploration,
  loading,
  error,
}: {
  exploration: ProductAnalyticsExploration | null;
  loading: boolean;
  error: string | null;
}) {
  if (error && !loading) return null;
  if (loading && !exploration) {
    return (
      <Flex p="4" align="center" justify="center">
        <LoadingSpinner />
      </Flex>
    );
  }
  if (!exploration) return null;

  const chart = getActivityChart(exploration);
  const average = chart.days.length ? chart.total / chart.days.length : null;
  return (
    <>
      <Box minWidth="0">
        <Text as="div" color="text-mid">
          Average members per day
        </Text>
        <PreviewHeadline
          value={average === null ? "—" : formatPreviewHeadline(average)}
          title={average?.toLocaleString()}
        />
        <Text size="sm" color="text-mid">
          Distinct members meeting the conditions each day. A member can appear
          on multiple days.
        </Text>
      </Box>
      <DailyBarChart
        days={chart.days}
        values={chart.counts}
        seriesName="Members"
        integerYAxis
        height={280}
      />
      {chart.total === 0 && (
        <Text color="text-mid">No members matched during this period.</Text>
      )}
    </>
  );
}

export default function PopulationPreview({
  population,
}: {
  population: ApiPopulation;
}) {
  const { getDatasourceById, getFactTableById } = useDefinitions();
  const permissions = usePermissionsUtil();
  const [selectedUnit, setSelectedUnit] = useState<string | null>(null);
  const unit =
    selectedUnit && population.userIdTypes.includes(selectedUnit)
      ? selectedUnit
      : (population.userIdTypes[0] ?? null);
  const utcToday = new Date().toISOString().slice(0, 10);
  const config = useMemo<PopulationExplorationConfig>(
    () => ({
      type: "population",
      datasource: population.datasource,
      chartType: "bar",
      showAs: "total",
      dateRange: getMetricPreviewDateRange(new Date(`${utcToday}T00:00:00Z`)),
      dimensions: [
        { dimensionType: "date", column: "date", dateGranularity: "day" },
      ],
      dataset: {
        type: "population",
        values: population.steps.map((step) => ({
          type: "population",
          name: "Members",
          unit,
          source: step.source,
          rowFilters: step.rowFilters,
          aggregateFilter: step.aggregateFilter,
          aggregateFilterColumn: step.aggregateFilterColumn,
        })),
      },
    }),
    [population, unit, utcToday],
  );
  const datasource = getDatasourceById(population.datasource);
  const step = population.steps[0];
  const factTable =
    step?.source.type === "factTable"
      ? getFactTableById(step.source.factTableId)
      : null;
  const unsupported =
    population.steps.length !== 1 ||
    population.steps.some((step) => step.windowSettings.type !== "");

  return (
    <Flex direction="column" gap="4" minWidth="0">
      <Heading as="h2" size="md" mb="0">
        Population Preview
      </Heading>
      {unsupported ? (
        <Callout status="info">
          Preview is available for single-step Populations without a time
          window.
        </Callout>
      ) : !datasource ? (
        <Callout status="error">The Data Source is unavailable.</Callout>
      ) : !permissions.canRunMetricQueries(datasource) ? (
        <Text color="text-mid">
          You don’t have permission to run queries on this Data Source.
        </Text>
      ) : (
        <ExplorerProvider
          initialConfig={config}
          queryEnabled={!!unit}
          trackingSource="population-preview"
        >
          <PreviewShell
            config={config}
            layout="page"
            emptyDescription="Run the query to see daily member counts for the last 7 complete days."
            warehouseUnavailableText="The preview will be available when the warehouse is ready."
            renderChart={({ exploration, loading, error }) => (
              <MembersChart
                exploration={exploration}
                loading={loading}
                error={error}
              />
            )}
            controls={
              <PreviewUnitSelect
                units={population.userIdTypes}
                value={unit}
                setValue={setSelectedUnit}
                factTable={factTable}
              />
            }
          />
        </ExplorerProvider>
      )}
    </Flex>
  );
}
