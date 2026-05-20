import { FC } from "react";
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
    <Flex direction="column">
      <div className="form-group col-md-12 px-0">
        <EventForwarderTableNameField
          label="Snowflake URL"
          name="eventForwarderSnowflakeUrl"
          value={snowflakeEventForwarderConfig.config.accessUrl || ""}
          onChange={(accessUrl) => updateConfig({ accessUrl })}
          placeholder="https://myorg-account123.snowflakecomputing.com"
          tooltip="HTTPS URL for the Confluent Snowflake Sink (snowflake.url.name). Copy from Snowsight if unsure. Examples: https://myorg-account123.snowflakecomputing.com or https://xy12345.us-east-1.aws.snowflakecomputing.com"
        />
      </div>
      <div className="form-group col-md-12 px-0">
        <EventForwarderTableNameField
          label="Destination table"
          value={snowflakeEventForwarderConfig.config.tableName}
          onChange={(tableName) => updateConfig({ tableName })}
          placeholder="EVENT_FORWARDER_DB.PUBLIC.GB_EVENTS"
          tooltip="Snowflake table where enriched events are written. Use DATABASE.SCHEMA.TABLE."
          subTitle="The table segment is normalized to uppercase with underscores when saving."
        />
      </div>
      <div className="col-md-12 px-0">
        <Field
          label="Role"
          type="text"
          className="form-control"
          name="eventForwarderRole"
          value={snowflakeEventForwarderConfig.config.role || ""}
          onChange={(e) => updateConfig({ role: e.target.value })}
          placeholder=""
          helpText="Snowflake role for the event forwarder connector. Defaults from the datasource connection."
        />
      </div>
      <div className="col-md-12 px-0">
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
          name="eventForwarderWarehouse"
          value={snowflakeEventForwarderConfig.config.warehouse || ""}
          onChange={(e) => updateConfig({ warehouse: e.target.value })}
          placeholder=""
        />
      </div>
    </Flex>
  );
};

export default SnowflakeEventForwarderForm;
