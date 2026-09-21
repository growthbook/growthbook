import { FC } from "react";
import { Flex } from "@radix-ui/themes";
import { EventForwarderConfigDraft } from "shared/types/event-forwarder";
import { parseDatabricksEventForwarderTablePrefix } from "shared/util";
import EventForwarderTableNameField from "./EventForwarderTableNameField";

const DatabricksEventForwarderForm: FC<{
  eventForwarderConfig: EventForwarderConfigDraft;
  setEventForwarderConfig: (
    eventForwarderConfig: EventForwarderConfigDraft | null,
  ) => void;
  destination: string;
  setDestination: (destination: string) => void;
}> = ({
  eventForwarderConfig,
  setEventForwarderConfig,
  destination,
  setDestination,
}) => {
  const databricksEventForwarderConfig =
    eventForwarderConfig.sinkType === "databricks"
      ? eventForwarderConfig
      : null;

  if (!databricksEventForwarderConfig) return null;

  const updateConfig = (
    patch: Partial<typeof databricksEventForwarderConfig.config>,
  ) => {
    setEventForwarderConfig({
      ...databricksEventForwarderConfig,
      config: {
        ...databricksEventForwarderConfig.config,
        ...patch,
      },
    });
  };

  return (
    <Flex direction="column" gap="2" className="form-group col-md-12 px-0">
      <EventForwarderTableNameField
        label="Destination"
        name="eventForwarderDatabricksDestination"
        value={destination}
        onChange={(value) => {
          setDestination(value);
          // Keep the draft in sync while typing; invalid input is reported on submit.
          try {
            updateConfig(parseDatabricksEventForwarderTablePrefix(value));
          } catch {
            // ignore until submit
          }
        }}
        placeholder="<catalog>.<schema>.gb"
        tooltip="Three dot-separated parts: catalog, schema, table prefix."
        helpText="catalog: the Unity Catalog catalog from your connection. schema: an existing schema the service principal can create tables in (we suggest a dedicated one, e.g. growthbook). gb: prefix for the gb_events, gb_experiment_viewed and gb_feature_usage tables."
      />
      <EventForwarderTableNameField
        label="Zerobus endpoint"
        name="eventForwarderDatabricksZerobusEndpoint"
        value={databricksEventForwarderConfig.config.zerobusEndpoint}
        onChange={(zerobusEndpoint) => updateConfig({ zerobusEndpoint })}
        placeholder="https://<workspace-id>.zerobus.<region>.cloud.databricks.com"
        tooltip="Zerobus Ingest endpoint for your workspace: https://<workspace-id>.zerobus.<region>.cloud.databricks.com or https://<workspace-id>.zerobus.<region>.azuredatabricks.net."
      />
    </Flex>
  );
};

export default DatabricksEventForwarderForm;
