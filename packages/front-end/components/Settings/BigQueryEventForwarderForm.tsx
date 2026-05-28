import { FC } from "react";
import { Flex } from "@radix-ui/themes";
import { EventForwarderConfigDraft } from "shared/types/event-forwarder";
import EventForwarderTableNameField from "./EventForwarderTableNameField";

const BigQueryEventForwarderForm: FC<{
  eventForwarderConfig: EventForwarderConfigDraft;
  setEventForwarderConfig: (
    eventForwarderConfig: EventForwarderConfigDraft | null,
  ) => void;
  className?: string;
}> = ({
  eventForwarderConfig,
  setEventForwarderConfig,
  className = "form-group col-md-12 mt-3 px-0",
}) => {
  const bigQueryEventForwarderConfig =
    eventForwarderConfig.sinkType === "bigquery" ? eventForwarderConfig : null;

  if (!bigQueryEventForwarderConfig) return null;

  return (
    <Flex direction="column" gap="3" className={className}>
      <EventForwarderTableNameField
        label="Destination table"
        value={bigQueryEventForwarderConfig.config.tableName}
        onChange={(tableName) =>
          setEventForwarderConfig({
            sinkType: "bigquery",
            config: {
              ...bigQueryEventForwarderConfig.config,
              tableName,
            },
          })
        }
        placeholder="my_dataset.gb_events"
        tooltip="BigQuery table where enriched events are written. Use dataset.table; project comes from the datasource unless you specify project.dataset.table."
        helpText="Example: analytics_123456789.gb_events. Letters, numbers, and underscores in the table name; hyphens and spaces are normalized to underscores when saving."
      />
    </Flex>
  );
};

export default BigQueryEventForwarderForm;
