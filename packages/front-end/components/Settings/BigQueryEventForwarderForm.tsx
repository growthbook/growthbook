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
        label="Destination tables prefix"
        value={bigQueryEventForwarderConfig.config.tablePrefix}
        onChange={(tablePrefix) =>
          setEventForwarderConfig({
            sinkType: "bigquery",
            config: {
              ...bigQueryEventForwarderConfig.config,
              tablePrefix,
            },
          })
        }
        placeholder="my_dataset.gb"
        tooltip="BigQuery table prefix used for Event Forwarder tables."
      />
    </Flex>
  );
};

export default BigQueryEventForwarderForm;
