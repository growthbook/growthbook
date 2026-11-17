import { FC } from "react";
import { Box, Grid } from "@radix-ui/themes";
import { EventForwarderConfigDraft } from "shared/types/event-forwarder";
import { DocLink } from "@/components/DocLink";
import { EventForwarderLockedField } from "@/components/DataSourceSetup/EventForwarderDestinationFields";
import LabelWithHelp from "@/ui/LabelWithHelp";
import TextFieldWithHelp from "./TextFieldWithHelp";

const DatabricksEventForwarderForm: FC<{
  eventForwarderConfig: EventForwarderConfigDraft;
  setEventForwarderConfig: (
    eventForwarderConfig: EventForwarderConfigDraft | null,
  ) => void;
  catalogReadOnly: boolean; // connection already names a catalog
  zerobusPlaceholder: string;
}> = ({
  eventForwarderConfig,
  setEventForwarderConfig,
  catalogReadOnly,
  zerobusPlaceholder,
}) => {
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

  const catalogTooltip = "Unity Catalog catalog the tables are created in.";

  return (
    <Grid columns="2" gap="4" align="start">
      <Box gridColumn="1 / -1">
        {catalogReadOnly ? (
          <EventForwarderLockedField
            label={<LabelWithHelp label="Catalog" help={catalogTooltip} />}
            value={config.catalog}
            helpText="From your Databricks connection. Change it on the connection settings if needed."
          />
        ) : (
          <TextFieldWithHelp
            label="Catalog"
            name="eventForwarderDatabricksCatalog"
            value={config.catalog}
            onChange={(catalog) => updateConfig({ catalog })}
            placeholder="main"
            tooltip={catalogTooltip}
          />
        )}
      </Box>
      <TextFieldWithHelp
        label="Schema"
        name="eventForwarderDatabricksSchema"
        value={config.schema}
        onChange={(schema) => updateConfig({ schema })}
        placeholder="growthbook"
        tooltip="An existing schema in the catalog that the service principal can create tables in."
        helpText="Must already exist. We suggest a dedicated schema such as growthbook."
      />
      <TextFieldWithHelp
        label="Table prefix (optional)"
        name="eventForwarderDatabricksTablePrefix"
        required={false}
        value={config.tablePrefix}
        onChange={(tablePrefix) => updateConfig({ tablePrefix })}
        placeholder="gb"
        tooltip="Prefix for the three tables GrowthBook creates."
        helpText={`Creates ${config.tablePrefix || "gb"}_events, ${config.tablePrefix || "gb"}_experiment_viewed and ${config.tablePrefix || "gb"}_feature_usage.`}
      />
      <Box gridColumn="1 / -1">
        <TextFieldWithHelp
          label="Zerobus endpoint"
          name="eventForwarderDatabricksZerobusEndpoint"
          value={config.zerobusEndpoint}
          onChange={(zerobusEndpoint) => updateConfig({ zerobusEndpoint })}
          placeholder={zerobusPlaceholder}
          tooltip="Zerobus Ingest endpoint for your workspace."
          helpText={
            <>
              Built from your workspace ID and cloud region.{" "}
              <DocLink docSection="eventForwarderZerobus" useRadix={false}>
                How to find these
              </DocLink>
            </>
          }
        />
      </Box>
    </Grid>
  );
};

export default DatabricksEventForwarderForm;
