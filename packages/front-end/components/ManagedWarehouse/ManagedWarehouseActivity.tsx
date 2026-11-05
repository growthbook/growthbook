import { useMemo } from "react";
import { Box, Card, Flex } from "@radix-ui/themes";
import { PiArrowRight } from "react-icons/pi";
import { encodeExplorationConfig } from "shared/enterprise";
import { MANAGED_WAREHOUSE_EVENTS_FACT_TABLE_ID } from "shared/constants";
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
  getManagedWarehouseActivityConfig,
  getManagedWarehouseDailyCounts,
} from "@/components/ManagedWarehouse/managedWarehouseActivityConfig";
import Callout from "@/ui/Callout";
import Heading from "@/ui/Heading";
import Link from "@/ui/Link";
import PermissionBlocker from "@/ui/PermissionBlocker";
import Text from "@/ui/Text";

function EventsChart({
  exploration,
  explorerHref,
}: {
  exploration: ProductAnalyticsExploration;
  explorerHref: string;
}) {
  const { dailyValues, total } = getManagedWarehouseDailyCounts(exploration);
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
      {total === 0 && (
        <Text color="text-mid">
          No events were received during this period.
        </Text>
      )}
    </>
  );
}

// Daily volume of the events the SDKs have sent to the Managed Warehouse.
export default function ManagedWarehouseActivity({
  dataSource,
}: {
  dataSource: DataSourceInterfaceWithParams;
}) {
  const { getFactTableById } = useDefinitions();
  const permissions = usePermissionsUtil();
  const factTable = getFactTableById(MANAGED_WAREHOUSE_EVENTS_FACT_TABLE_ID);
  const factTableId =
    factTable?.datasource === dataSource.id ? factTable.id : null;
  const dateRange = usePreviewDateRange();
  const config = useMemo(
    () =>
      factTableId
        ? getManagedWarehouseActivityConfig({
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
          Recent Events
        </Heading>
        {!config ? (
          <Callout status="warning">
            Event counts are unavailable because the Managed Warehouse&apos;s
            events Fact Table wasn&apos;t found.
          </Callout>
        ) : canRunQueries ? (
          <PreviewExplorer
            config={config}
            trackingSource="managed-warehouse-activity"
            emptyDescription="Run the query to see daily event counts for the last 7 complete days."
            warehouseUnavailableText="Event counts will be available when the warehouse is ready."
            renderChart={({ exploration }) => (
              <EventsChart
                exploration={exploration}
                explorerHref={`/product-analytics/explore/fact-table?config=${encodeExplorationConfig(config)}`}
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
