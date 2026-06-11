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
          label="Snowflake Access URL"
          name="eventForwarderSnowflakeUrl"
          value={snowflakeEventForwarderConfig.config.accessUrl || ""}
          onChange={(accessUrl) => updateConfig({ accessUrl })}
          placeholder="https://myorg-account123.snowflakecomputing.com"
          tooltip="Derived from the Snowflake datasource connection (account or access URL). Update the datasource settings to change this value."
          readOnly
        />
      </div>
      <div className="form-group col-md-12 px-0">
        <EventForwarderTableNameField
          label="Destination tables prefix"
          value={snowflakeEventForwarderConfig.config.tablePrefix}
          onChange={(tablePrefix) => updateConfig({ tablePrefix })}
          placeholder="EVENT_FORWARDER_DB.PUBLIC.GB"
          tooltip="Snowflake table prefix used for Event Forwarder tables. Use DATABASE.SCHEMA.PREFIX."
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
          helpText="Required. Snowflake role for the Confluent Snowflake Sink (Snowpipe Streaming + schema evolution). Defaults from the datasource connection."
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
