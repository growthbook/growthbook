import { MANAGED_WAREHOUSE_EVENTS_FACT_TABLE_ID } from "shared/constants";
import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import { useDefinitions } from "@/services/DefinitionsContext";
import EventActivityCard from "@/components/QueryPreview/EventActivityCard";

// Daily volume of the events the SDKs have sent to the Managed Warehouse.
export default function ManagedWarehouseActivity({
  dataSource,
}: {
  dataSource: DataSourceInterfaceWithParams;
}) {
  const { getFactTableById } = useDefinitions();
  const factTable = getFactTableById(MANAGED_WAREHOUSE_EVENTS_FACT_TABLE_ID);
  const factTableId =
    factTable?.datasource === dataSource.id ? factTable.id : null;

  return (
    <EventActivityCard
      dataSource={dataSource}
      factTableId={factTableId}
      title="Events Received"
      trackingSource="managed-warehouse-activity"
      missingFactTableMessage="Event counts are unavailable because the Managed Warehouse's events Fact Table wasn't found."
      noEventsMessage="No events were received during this period."
    />
  );
}
