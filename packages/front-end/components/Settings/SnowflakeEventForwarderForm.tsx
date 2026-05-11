import { FC } from "react";
import { DEFAULT_EVENT_FORWARDER_SNOWFLAKE_TABLE_NAME } from "shared/util";
import { EventForwarderConfigDraft } from "shared/types/event-forwarder";
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

  return (
    <>
      <div className="form-group col-md-12">
        <EventForwarderTableNameField
          label="Event Forwarder Access URL"
          name="eventForwarderAccessUrl"
          value={snowflakeEventForwarderConfig.config.accessUrl || ""}
          onChange={(accessUrl) =>
            setEventForwarderConfig({
              sinkType: "snowflake",
              config: {
                ...snowflakeEventForwarderConfig.config,
                accessUrl,
              },
            })
          }
          placeholder="https://abcd12345.us-east-1.snowflakecomputing.com:443"
          tooltip="Full Snowflake URL for Confluent Snowflake Sink, including the region, for example https://abcd12345.us-east-1.snowflakecomputing.com:443"
        />
      </div>
      <div className="form-group col-md-12">
        <EventForwarderTableNameField
          value={snowflakeEventForwarderConfig.config.tableName}
          onChange={(tableName) =>
            setEventForwarderConfig({
              sinkType: "snowflake",
              config: {
                ...snowflakeEventForwarderConfig.config,
                tableName,
              },
            })
          }
          placeholder={DEFAULT_EVENT_FORWARDER_SNOWFLAKE_TABLE_NAME}
          tooltip="Defaults to GB_EVENTS. GrowthBook maps the Kafka topic to this Snowflake table."
          subTitle="Letters, numbers, underscores, and dollar signs. Hyphens and spaces are normalized to underscores when saving."
        />
      </div>
    </>
  );
};

export default SnowflakeEventForwarderForm;
