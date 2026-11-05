import { useMemo } from "react";
import { Box, Card, Flex } from "@radix-ui/themes";
import { PiArrowRight } from "react-icons/pi";
import { encodeExplorationConfig } from "shared/enterprise";
import { getEventForwarderEventsFactTableId } from "shared/util";
import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import { ProductAnalyticsExploration } from "shared/validators";
import { useDefinitions } from "@/services/DefinitionsContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import DailyBarChart from "@/components/QueryPreview/DailyBarChart";
import PreviewHeadline from "@/components/QueryPreview/PreviewHeadline";
import {
  formatPreviewHeadline,
  usePreviewDateRange,
} from "@/components/QueryPreview/previewUtils";
import PreviewExplorer, {
  DisabledPreview,
} from "@/enterprise/components/ProductAnalytics/PreviewExplorer";
import {
  getEventForwarderActivityConfig,
  getEventForwarderDailyCounts,
  getEventForwarderExplorerConfig,
} from "@/components/Settings/EditDataSource/EventForwarder/eventForwarderActivityConfig";
import Heading from "@/ui/Heading";
import Link from "@/ui/Link";
import PermissionBlocker from "@/ui/PermissionBlocker";
import Text from "@/ui/Text";

function EventsChart({
  exploration,
}: {
  exploration: ProductAnalyticsExploration;
}) {
  const { dailyValues, total } = getEventForwarderDailyCounts(exploration);
  return (
    <>
      <Box minWidth="0">
        <Text as="div" color="text-mid">
          Total events
        </Text>
        <PreviewHeadline
          value={formatPreviewHeadline(total)}
          title={total.toLocaleString()}
        />
      </Box>
      <DailyBarChart
        dailyValues={dailyValues}
        seriesName="Events"
        integerYAxis
        height={160}
      />
      {total === 0 && (
        <Text color="text-mid">No events were tracked during this period.</Text>
      )}
    </>
  );
}

// Daily volume of the events the Event Forwarder has written to the warehouse.
export default function EventForwarderActivity({
  dataSource,
}: {
  dataSource: DataSourceInterfaceWithParams;
}) {
  const { getFactTableById } = useDefinitions();
  const permissions = usePermissionsUtil();
  const factTableId =
    getFactTableById(getEventForwarderEventsFactTableId(dataSource.id))?.id ??
    null;
  const dateRange = usePreviewDateRange();
  const config = useMemo(
    () =>
      factTableId
        ? getEventForwarderActivityConfig({
            datasourceId: dataSource.id,
            factTableId,
            dateRange,
          })
        : null,
    [dataSource.id, factTableId, dateRange],
  );

  if (!config) return null;

  const canRunQueries = permissions.canRunFactQueries(dataSource);
  const explorerHref = `/product-analytics/explore/fact-table?config=${encodeExplorationConfig(
    getEventForwarderExplorerConfig(config),
  )}`;

  return (
    <Card mb="4">
      <Box p="2">
        <Flex direction="column" gap="3" minWidth="0">
          <Flex align="center" justify="between" gap="3">
            <Heading as="h4" size="sm" mb="0">
              Recent Forwarded Events
            </Heading>
            {canRunQueries ? (
              <Link href={explorerHref}>
                Explore further <PiArrowRight />
              </Link>
            ) : null}
          </Flex>
          {canRunQueries ? (
            <PreviewExplorer
              config={config}
              trackingSource="event-forwarder-activity"
              emptyDescription="Run the query to see daily event counts for the last 7 complete days."
              warehouseUnavailableText="Event counts will be available when the warehouse is ready."
              renderChart={({ exploration }) => (
                <EventsChart exploration={exploration} />
              )}
            />
          ) : (
            <DisabledPreview description="Daily event counts for the last 7 complete days appear here.">
              <PermissionBlocker>
                You don’t have permission to run queries on this Data Source.
              </PermissionBlocker>
            </DisabledPreview>
          )}
        </Flex>
      </Box>
    </Card>
  );
}
