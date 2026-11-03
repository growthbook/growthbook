import { useMemo, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { ApiPopulation, ProductAnalyticsExploration } from "shared/validators";
import { useDefinitions } from "@/services/DefinitionsContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import DailyBarChart from "@/components/QueryPreview/DailyBarChart";
import PreviewHeadline from "@/components/QueryPreview/PreviewHeadline";
import PreviewExplorer, {
  DisabledPreview,
} from "@/enterprise/components/ProductAnalytics/PreviewExplorer";
import PreviewUnitSelect from "@/components/QueryPreview/PreviewUnitSelect";
import {
  usePreviewDateRange,
  formatPreviewHeadline,
} from "@/components/QueryPreview/previewUtils";
import {
  getPopulationMemberCounts,
  getPopulationPreviewConfig,
} from "@/components/Populations/populationUtils";
import Callout from "@/ui/Callout";
import Heading from "@/ui/Heading";
import PermissionBlocker from "@/ui/PermissionBlocker";
import Text from "@/ui/Text";

function MembersChart({
  exploration,
  hasAggregateFilter,
}: {
  exploration: ProductAnalyticsExploration;
  hasAggregateFilter: boolean;
}) {
  const chart = getPopulationMemberCounts(exploration);
  const average = chart.dailyValues.length
    ? chart.total / chart.dailyValues.length
    : null;
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
          Distinct members per day. A member can appear on multiple days.
          {hasAggregateFilter && " Thresholds apply per day."}
        </Text>
      </Box>
      <DailyBarChart
        dailyValues={chart.dailyValues}
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
      : population.userIdTypes[0];
  const dateRange = usePreviewDateRange();
  const config = useMemo(
    () => getPopulationPreviewConfig(population, unit, dateRange),
    [population, unit, dateRange],
  );
  const datasource = getDatasourceById(population.datasource);
  const step = population.steps[0];
  const factTable =
    step?.source.type === "factTable"
      ? getFactTableById(step.source.factTableId)
      : null;

  return (
    <Flex direction="column" gap="4" minWidth="0">
      <Heading as="h2" size="md" mb="0">
        Population Preview
      </Heading>
      {!datasource ? (
        <Callout status="error">The Data Source is unavailable.</Callout>
      ) : !permissions.canRunMetricQueries(datasource) ? (
        <DisabledPreview description="Daily member counts for the last 7 complete days appear here.">
          <PermissionBlocker>
            You don’t have permission to run queries on this Data Source.
          </PermissionBlocker>
        </DisabledPreview>
      ) : (
        <PreviewExplorer
          config={config}
          trackingSource="population-preview"
          emptyDescription="Run the query to see daily member counts for the last 7 complete days."
          warehouseUnavailableText="The preview will be available when the warehouse is ready."
          renderChart={({ exploration, submittedExploreState }) => (
            <MembersChart
              exploration={exploration}
              hasAggregateFilter={
                submittedExploreState.dataset.type === "population" &&
                submittedExploreState.dataset.values.some(
                  (value) => !!value.aggregateFilter,
                )
              }
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
      )}
    </Flex>
  );
}
