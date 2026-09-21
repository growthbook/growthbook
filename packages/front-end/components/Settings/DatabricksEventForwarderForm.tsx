import { FC } from "react";
import { Flex } from "@radix-ui/themes";
import { EventForwarderConfigDraft } from "shared/types/event-forwarder";
import EventForwarderTableNameField from "./EventForwarderTableNameField";

const DatabricksEventForwarderForm: FC<{
  eventForwarderConfig: EventForwarderConfigDraft;
  setEventForwarderConfig: (
    eventForwarderConfig: EventForwarderConfigDraft | null,
  ) => void;
  // True when the datasource connection already names a catalog.
  catalogReadOnly: boolean;
}> = ({ eventForwarderConfig, setEventForwarderConfig, catalogReadOnly }) => {
  const databricksEventForwarderConfig =
    eventForwarderConfig.sinkType === "databricks"
      ? eventForwarderConfig
      : null;

  if (!databricksEventForwarderConfig) return null;

  const { config } = databricksEventForwarderConfig;
  const updateConfig = (patch: Partial<typeof config>) => {
    setEventForwarderConfig({
      ...databricksEventForwarderConfig,
      config: { ...config, ...patch },
    });
  };

  return (
    <Flex direction="column" gap="2" className="form-group col-md-12 px-0">
      <EventForwarderTableNameField
        label="Catalog"
        name="eventForwarderDatabricksCatalog"
        value={config.catalog}
        onChange={(catalog) => updateConfig({ catalog })}
        placeholder="main"
        tooltip="Unity Catalog catalog the tables are created in."
        helpText={
          catalogReadOnly
            ? "From your Databricks connection. Change it on the connection settings if needed."
            : undefined
        }
        readOnly={catalogReadOnly}
      />
      <EventForwarderTableNameField
        label="Schema"
        name="eventForwarderDatabricksSchema"
        value={config.schema}
        onChange={(schema) => updateConfig({ schema })}
        placeholder="growthbook"
        tooltip="An existing schema in the catalog that the service principal can create tables in."
        helpText="Must already exist. We suggest a dedicated schema such as growthbook."
      />
      <EventForwarderTableNameField
        label="Table prefix"
        name="eventForwarderDatabricksTablePrefix"
        value={config.tablePrefix}
        onChange={(tablePrefix) => updateConfig({ tablePrefix })}
        placeholder="gb"
        tooltip="Prefix for the three tables GrowthBook creates."
        helpText={`Creates ${config.tablePrefix || "gb"}_events, ${config.tablePrefix || "gb"}_experiment_viewed and ${config.tablePrefix || "gb"}_feature_usage.`}
      />
      <EventForwarderTableNameField
        label="Zerobus endpoint"
        name="eventForwarderDatabricksZerobusEndpoint"
        value={config.zerobusEndpoint}
        onChange={(zerobusEndpoint) => updateConfig({ zerobusEndpoint })}
        placeholder="https://<workspace-id>.zerobus.<region>.cloud.databricks.com"
        tooltip="Zerobus Ingest endpoint for your workspace: https://<workspace-id>.zerobus.<region>.cloud.databricks.com or https://<workspace-id>.zerobus.<region>.azuredatabricks.net."
      />
    </Flex>
  );
};

export default DatabricksEventForwarderForm;
