import { FC } from "react";
import { Box, Grid } from "@radix-ui/themes";
import { EventForwarderConfigDraft } from "shared/types/event-forwarder";
import { DocLink } from "@/components/DocLink";
import TextField from "@/ui/TextField";
import TextFieldWithHelp from "./TextFieldWithHelp";

const SnowflakeEventForwarderForm: FC<{
  eventForwarderConfig: EventForwarderConfigDraft;
  setEventForwarderConfig: (
    eventForwarderConfig: EventForwarderConfigDraft | null,
  ) => void;
}> = ({ eventForwarderConfig, setEventForwarderConfig }) => {
  const snowflakeEventForwarderConfig =
    eventForwarderConfig.sinkType === "snowflake" ? eventForwarderConfig : null;

  if (!snowflakeEventForwarderConfig) return null;

  const updateConfig = (
    patch: Partial<typeof snowflakeEventForwarderConfig.config>,
  ) => {
    setEventForwarderConfig({
      ...snowflakeEventForwarderConfig,
      config: {
        ...snowflakeEventForwarderConfig.config,
        ...patch,
      },
    });
  };

  return (
    <Grid columns="2" gap="4" align="start">
      <Box gridColumn="1 / -1">
        <TextFieldWithHelp
          label="Snowflake access URL"
          name="eventForwarderSnowflakeUrl"
          value={snowflakeEventForwarderConfig.config.accessUrl || ""}
          onChange={(accessUrl) => updateConfig({ accessUrl })}
          placeholder="https://myorg-account123.snowflakecomputing.com"
          tooltip="Enter the full Snowflake URL (e.g. https://myorg-account123.snowflakecomputing.com)."
        />
      </Box>
      <TextField
        label="Database"
        name="eventForwarderSnowflakeDatabase"
        value={snowflakeEventForwarderConfig.config.database}
        onChange={(e) => updateConfig({ database: e.target.value })}
        placeholder="EVENT_FORWARDER_DB"
        required
      />
      <TextField
        label="Schema"
        name="eventForwarderSnowflakeSchema"
        value={snowflakeEventForwarderConfig.config.schema}
        onChange={(e) => updateConfig({ schema: e.target.value })}
        placeholder="PUBLIC"
        required
      />
      <TextField
        label="Table prefix (optional)"
        name="eventForwarderSnowflakeTablePrefix"
        value={snowflakeEventForwarderConfig.config.tablePrefix}
        onChange={(e) => updateConfig({ tablePrefix: e.target.value })}
        placeholder="GB"
        helpText="GrowthBook creates EVENTS, EXPERIMENT_VIEWED, and FEATURE_USAGE tables using this prefix."
      />
      <TextFieldWithHelp
        label="Warehouse (optional)"
        name="eventForwarderWarehouse"
        value={snowflakeEventForwarderConfig.config.warehouse || ""}
        onChange={(warehouse) => updateConfig({ warehouse })}
        tooltip="If empty, Snowflake uses the default warehouse for the user."
        required={false}
      />
      <Box gridColumn="1 / -1">
        <TextField
          label="Role"
          name="eventForwarderRole"
          value={snowflakeEventForwarderConfig.config.role || ""}
          onChange={(e) => updateConfig({ role: e.target.value })}
          helpText={
            <>
              Prefilled from the Data Source connection. Snowpipe Streaming
              writes as this Snowflake user&apos;s default role, so this has to
              be that role.{" "}
              <DocLink docSection="eventForwarderSnowflake" useRadix={false}>
                How to set it
              </DocLink>
            </>
          }
        />
      </Box>
    </Grid>
  );
};

export default SnowflakeEventForwarderForm;
