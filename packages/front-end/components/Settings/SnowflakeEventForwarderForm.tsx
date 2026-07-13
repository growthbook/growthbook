import { FC, useState } from "react";
import { Flex } from "@radix-ui/themes";
import { EventForwarderConfigDraft } from "shared/types/event-forwarder";
import Field from "@/components/Forms/Field";
import Tooltip from "@/components/Tooltip/Tooltip";
import { GBInfo } from "@/components/Icons";
import EventForwarderTableNameField from "./EventForwarderTableNameField";

const SnowflakeEventForwarderForm: FC<{
  eventForwarderConfig: EventForwarderConfigDraft;
  setEventForwarderConfig: (
    eventForwarderConfig: EventForwarderConfigDraft | null,
  ) => void;
}> = ({ eventForwarderConfig, setEventForwarderConfig }) => {
  const snowflakeEventForwarderConfig =
    eventForwarderConfig.sinkType === "snowflake" ? eventForwarderConfig : null;

  // The access URL is normally derived from the datasource account and shown
  // read-only. When it couldn't be derived (e.g. a bare account locator like
  // "xy12345"), it arrives empty — let the user enter it directly instead.
  // Decided once on mount so typing the first character doesn't re-lock it.
  const [accessUrlReadOnly] = useState(
    () =>
      eventForwarderConfig.sinkType === "snowflake" &&
      !!eventForwarderConfig.config.accessUrl?.trim(),
  );

  if (!snowflakeEventForwarderConfig) return null;

  const updateConfig = (
    patch: Partial<typeof snowflakeEventForwarderConfig.config>,
  ) => {
    setEventForwarderConfig({
      sinkType: "snowflake",
      config: {
        ...snowflakeEventForwarderConfig.config,
        ...patch,
      },
    });
  };

  return (
    <Flex direction="column" gap="2" className="form-group col-md-12 px-0">
      <EventForwarderTableNameField
        label="Snowflake Access URL"
        name="eventForwarderSnowflakeUrl"
        value={snowflakeEventForwarderConfig.config.accessUrl || ""}
        onChange={(accessUrl) => updateConfig({ accessUrl })}
        placeholder="https://myorg-account123.snowflakecomputing.com"
        tooltip={
          accessUrlReadOnly
            ? "Derived from the Snowflake datasource connection (account or access URL). Update the datasource settings to change this value."
            : "Couldn't be derived from the datasource account. Enter the full Snowflake URL (e.g. https://myorg-account123.snowflakecomputing.com)."
        }
        readOnly={accessUrlReadOnly}
      />
      <Field
        label="Database"
        type="text"
        className="form-control"
        containerClassName="mb-0"
        name="eventForwarderSnowflakeDatabase"
        value={snowflakeEventForwarderConfig.config.database}
        onChange={(e) => updateConfig({ database: e.target.value })}
        placeholder="EVENT_FORWARDER_DB"
        required
      />
      <Field
        label="Schema"
        type="text"
        className="form-control"
        containerClassName="mb-0"
        name="eventForwarderSnowflakeSchema"
        value={snowflakeEventForwarderConfig.config.schema}
        onChange={(e) => updateConfig({ schema: e.target.value })}
        placeholder="PUBLIC"
        required
      />
      <Field
        label="Table Prefix (optional)"
        type="text"
        className="form-control"
        containerClassName="mb-0"
        name="eventForwarderSnowflakeTablePrefix"
        value={snowflakeEventForwarderConfig.config.tablePrefix}
        onChange={(e) => updateConfig({ tablePrefix: e.target.value })}
        placeholder="GB"
        helpText="GrowthBook creates EVENTS, EXPERIMENT_VIEWED, and FEATURE_USAGE tables using this prefix."
      />
      <Field
        label="Role"
        type="text"
        className="form-control"
        containerClassName="mb-0"
        name="eventForwarderRole"
        value={snowflakeEventForwarderConfig.config.role || ""}
        onChange={(e) => updateConfig({ role: e.target.value })}
        placeholder=""
        helpText="Required. Snowflake role for the Confluent Snowflake Sink (Snowpipe Streaming + schema evolution). Defaults from the datasource connection."
      />
      <Field
        label={
          <>
            Warehouse (optional){" "}
            <Tooltip body="If empty, Snowflake uses the default warehouse for the user.">
              <GBInfo />
            </Tooltip>
          </>
        }
        type="text"
        className="form-control"
        containerClassName="mb-0"
        name="eventForwarderWarehouse"
        value={snowflakeEventForwarderConfig.config.warehouse || ""}
        onChange={(e) => updateConfig({ warehouse: e.target.value })}
        placeholder=""
      />
    </Flex>
  );
};

export default SnowflakeEventForwarderForm;
