import { Box } from "@radix-ui/themes";
import { getEventForwarderEventsFactTableId } from "shared/util";
import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import { useDefinitions } from "@/services/DefinitionsContext";
import EventActivityCard from "@/components/QueryPreview/EventActivityCard";
import { getEventForwarderNoEventsMessage } from "@/components/Settings/EditDataSource/EventForwarder/eventForwarderActivityConfig";

// Daily volume of the events the Event Forwarder has written to the warehouse.
export default function EventForwarderActivity({
  dataSource,
  isPaused,
  isOverLimit,
}: {
  dataSource: DataSourceInterfaceWithParams;
  isPaused: boolean;
  isOverLimit: boolean;
}) {
  const { getFactTableById } = useDefinitions();
  const factTableId =
    getFactTableById(getEventForwarderEventsFactTableId(dataSource.id))?.id ??
    null;

  return (
    <Box mb="4">
      <EventActivityCard
        dataSource={dataSource}
        factTableId={factTableId}
        title="Recent Forwarded Events"
        trackingSource="event-forwarder-activity"
        missingFactTableMessage="Event counts are unavailable because the Event Forwarder's events Fact Table wasn't found."
        noEventsMessage={getEventForwarderNoEventsMessage({
          isPaused,
          isOverLimit,
        })}
      />
    </Box>
  );
}
