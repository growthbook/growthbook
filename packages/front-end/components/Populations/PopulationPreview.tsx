import { ReactNode, useEffect, useMemo, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiArrowClockwise } from "react-icons/pi";
import { ago, datetime } from "shared/dates";
import { ApiPopulation, PopulationExplorationConfig } from "shared/validators";
import { useDefinitions } from "@/services/DefinitionsContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import {
  ExplorerProvider,
  useExplorerContext,
} from "@/enterprise/components/ProductAnalytics/ExplorerContext";
import DailyBarChart from "@/enterprise/components/ProductAnalytics/MainSection/DailyBarChart";
import {
  getMetricPreviewDateRange,
  formatPreviewHeadline,
} from "@/components/FactTables/MetricEditor/metricPreview";
import { getActivityChart } from "@/components/FactTables/MetricEditor/activityChart";
import LoadingSpinner from "@/components/LoadingSpinner";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";
import { Select, SelectItem } from "@/ui/Select";

function Placeholder({ children }: { children: ReactNode }) {
  return (
    <Flex
      direction="column"
      align="center"
      justify="center"
      gap="3"
      style={{ minHeight: 240 }}
    >
      {children}
    </Flex>
  );
}

function MembersChart({
  chart,
}: {
  chart: ReturnType<typeof getActivityChart>;
}) {
  return (
    <>
      <Box>
        <Text as="div" color="text-mid">
          Average members per day
        </Text>
        <div
          style={{
            fontSize: "3rem",
            lineHeight: 1.2,
            fontWeight: 600,
          }}
        >
          {chart.days.length
            ? formatPreviewHeadline(chart.total / chart.days.length)
            : "—"}
        </div>
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

function PreviewBody({
  chart,
  loading,
  error,
}: {
  chart: ReturnType<typeof getActivityChart> | null;
  loading: boolean;
  error: string | null;
}) {
  if (chart) return <MembersChart chart={chart} />;
  if (loading) {
    return (
      <Placeholder>
        <LoadingSpinner />
      </Placeholder>
    );
  }
  // The caller shows the error in place of the chart.
  if (error) return null;
  return (
    <Placeholder>
      <Text size="lg" weight="semibold" align="center">
        Preview will appear here
      </Text>
      <Text color="text-mid" align="center">
        Run the query to see daily member counts for the last 7 complete days.
      </Text>
    </Placeholder>
  );
}

function PreviewResults({ config }: { config: PopulationExplorationConfig }) {
  const {
    exploration,
    loading,
    error,
    isSubmittable,
    managedWarehouseUnavailable,
    handleSubmit,
    setDraftExploreState,
    isStale,
    needsFetch,
  } = useExplorerContext();
  useEffect(() => {
    setDraftExploreState(config);
  }, [config, setDraftExploreState]);
  const outdated = !!exploration && (isStale || needsFetch);
  // A failed run still returns an exploration with empty rows; don't chart it.
  const chart = exploration && !error ? getActivityChart(exploration) : null;

  if (managedWarehouseUnavailable) {
    return (
      <Text color="text-mid">
        The preview will be available when the warehouse is ready.
      </Text>
    );
  }

  return (
    <Flex direction="column" gap="4" aria-busy={loading}>
      {outdated && (
        <Callout status="warning" size="sm">
          Changes not applied. Refresh to update the preview.
        </Callout>
      )}
      {error && !loading && <Callout status="error">{error}</Callout>}
      <PreviewBody chart={chart} loading={loading} error={error} />
      <Flex
        justify="end"
        align="center"
        gap="3"
        wrap="wrap"
        pt="3"
        style={{ borderTop: "1px solid var(--gray-5)" }}
      >
        {exploration && (
          <Tooltip content={datetime(exploration.dateUpdated)}>
            <Text size="sm" color="text-mid">
              Updated {ago(exploration.dateUpdated)}
            </Text>
          </Tooltip>
        )}
        <Button
          variant={exploration ? "ghost" : "solid"}
          icon={exploration ? <PiArrowClockwise /> : undefined}
          disabled={loading || !isSubmittable}
          onClick={() => handleSubmit({ force: !!exploration })}
        >
          {loading ? "Loading…" : exploration ? "Refresh" : "Run query"}
        </Button>
      </Flex>
    </Flex>
  );
}

export default function PopulationPreview({
  population,
}: {
  population: ApiPopulation;
}) {
  const { getDatasourceById } = useDefinitions();
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
        <>
          <Flex justify="between" align="center" gap="3" wrap="wrap">
            <Select
              size="sm"
              aria-label="Identifier type"
              value={unit ?? ""}
              setValue={setSelectedUnit}
            >
              {population.userIdTypes.map((id) => (
                <SelectItem key={id} value={id}>
                  {id}
                </SelectItem>
              ))}
            </Select>
            <Text size="sm" color="text-mid">
              Last 7 complete days (UTC)
            </Text>
          </Flex>
          <ExplorerProvider
            initialConfig={config}
            queryEnabled={!!unit}
            trackingSource="population-preview"
          >
            <PreviewResults config={config} />
          </ExplorerProvider>
        </>
      )}
    </Flex>
  );
}
