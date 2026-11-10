import { useMemo } from "react";
import { Box, Card, Flex } from "@radix-ui/themes";
import { PiArrowRight } from "react-icons/pi";
import { encodeExplorationConfig } from "shared/enterprise";
import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import { ProductAnalyticsExploration } from "shared/validators";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import DailyBarChart from "@/components/QueryPreview/DailyBarChart";
import PreviewHeadline from "@/components/QueryPreview/PreviewHeadline";
import {
  formatPreviewHeadline,
  usePreviewDateRange,
} from "@/components/QueryPreview/previewUtils";
import {
  getEventActivityConfig,
  getEventActivityDailyCounts,
} from "@/components/QueryPreview/eventActivityConfig";
import PreviewExplorer, {
  DisabledPreview,
} from "@/enterprise/components/ProductAnalytics/PreviewExplorer";
import Callout from "@/ui/Callout";
import Heading from "@/ui/Heading";
import Link from "@/ui/Link";
import PermissionBlocker from "@/ui/PermissionBlocker";
import Text from "@/ui/Text";

function EventsChart({
  exploration,
  explorerHref,
  noEventsMessage,
}: {
  exploration: ProductAnalyticsExploration;
  explorerHref: string;
  noEventsMessage: string;
}) {
  const { dailyValues, total } = getEventActivityDailyCounts(exploration);
  return (
    <>
      <Flex align="start" justify="between" gap="3">
        <Box minWidth="0">
          <Text as="div" color="text-mid">
            Total events
          </Text>
          <PreviewHeadline
            value={formatPreviewHeadline(total)}
            title={total.toLocaleString()}
          />
        </Box>
        <Link href={explorerHref}>
          Explore further <PiArrowRight />
        </Link>
      </Flex>
      <DailyBarChart
        dailyValues={dailyValues}
        seriesName="Events"
        integerYAxis
        height={160}
      />
      {total === 0 && <Text color="text-mid">{noEventsMessage}</Text>}
    </>
  );
}

// Daily volume of events in a managed events fact table.
export default function EventActivityCard({
  dataSource,
  factTableId,
  title,
  trackingSource,
  missingFactTableMessage,
  noEventsMessage,
}: {
  dataSource: DataSourceInterfaceWithParams;
  factTableId: string | null;
  title: string;
  trackingSource: string;
  missingFactTableMessage: string;
  noEventsMessage: string;
}) {
  const permissions = usePermissionsUtil();
  const dateRange = usePreviewDateRange();
  const config = useMemo(
    () =>
      factTableId
        ? getEventActivityConfig({
            datasourceId: dataSource.id,
            factTableId,
            dateRange,
          })
        : null,
    [dataSource.id, factTableId, dateRange],
  );

  const canRunQueries = permissions.canRunFactQueries(dataSource);

  return (
    <Card>
      <Flex direction="column" gap="3" p="2" minWidth="0">
        <Heading as="h4" size="sm" mb="0">
          {title}
        </Heading>
        {!config ? (
          <Callout status="warning">{missingFactTableMessage}</Callout>
        ) : canRunQueries ? (
          <PreviewExplorer
            config={config}
            trackingSource={trackingSource}
            emptyDescription="Run the query to see daily event counts for the last 7 complete days."
            warehouseUnavailableText="Event counts will be available when the warehouse is ready."
            renderChart={({ exploration }) => (
              <EventsChart
                exploration={exploration}
                explorerHref={`/product-analytics/explore/fact-table?config=${encodeExplorationConfig(config)}`}
                noEventsMessage={noEventsMessage}
              />
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
    </Card>
  );
}
