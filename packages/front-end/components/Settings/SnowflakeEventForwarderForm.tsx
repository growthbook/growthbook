import { FC } from "react";
import { DEFAULT_EVENT_FORWARDER_SNOWFLAKE_TABLE_NAME } from "shared/util";
import { DataSourceParams } from "shared/types/datasource";
import { SnowflakeConnectionParams } from "shared/types/integrations/snowflake";
import { EventForwarderConfigDraft } from "shared/types/event-forwarder";
import Tooltip from "@/components/Tooltip/Tooltip";
import Button from "@/components/Button";
import Callout from "@/ui/Callout";
import EventForwarderTableNameField from "./EventForwarderTableNameField";
import { useEventForwarderAccessTest } from "./useEventForwarderAccessTest";

const SnowflakeEventForwarderForm: FC<{
  params: Partial<SnowflakeConnectionParams>;
  accessTestParams?: Partial<DataSourceParams>;
  eventForwarderConfig: EventForwarderConfigDraft;
  existing: boolean;
  setEventForwarderConfig: (
    eventForwarderConfig: EventForwarderConfigDraft | null,
  ) => void;
  datasourceId?: string;
  projects?: string[];
  eventForwarderAccessSignature: string;
  setValidatedEventForwarderSignature?: (signature: string | null) => void;
  hasSnowflakePrivateKey: boolean;
}> = ({
  params,
  accessTestParams,
  eventForwarderConfig,
  existing,
  setEventForwarderConfig,
  datasourceId,
  projects,
  eventForwarderAccessSignature,
  setValidatedEventForwarderSignature,
  hasSnowflakePrivateKey,
}) => {
  const snowflakeEventForwarderConfig =
    eventForwarderConfig.sinkType === "snowflake" ? eventForwarderConfig : null;
  const { eventForwarderTestResult, testEventForwarderAccess } =
    useEventForwarderAccessTest({
      existing,
      datasourceId,
      type: "snowflake",
      params: accessTestParams ?? params,
      projects,
      eventForwarderConfig: snowflakeEventForwarderConfig,
      eventForwarderAccessSignature,
      setValidatedEventForwarderSignature,
    });

  if (!snowflakeEventForwarderConfig) return null;

  const authMethod = params.authMethod ?? "password";
  const canTestEventForwarderAccess =
    !!snowflakeEventForwarderConfig.config.tableName.trim() &&
    !!snowflakeEventForwarderConfig.config.accessUrl?.trim() &&
    !!params.account?.trim() &&
    !!params.username?.trim() &&
    !!params.database?.trim() &&
    !!params.schema?.trim() &&
    authMethod === "key-pair" &&
    hasSnowflakePrivateKey;

  return (
    <>
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
          helpText="Letters, numbers, underscores, and dollar signs. Hyphens and spaces are normalized to underscores when saving."
        />
      </div>
      <div className="form-group col-md-12">
        <label>
          Event Forwarder Access URL{" "}
          <Tooltip body="Full Snowflake URL for Confluent Snowflake Sink, including the region, for example https://abcd12345.us-east-1.snowflakecomputing.com:443" />
        </label>
        <input
          type="text"
          className="form-control"
          name="eventForwarderAccessUrl"
          required
          placeholder="https://abcd12345.us-east-1.snowflakecomputing.com:443"
          value={snowflakeEventForwarderConfig.config.accessUrl || ""}
          onChange={(e) =>
            setEventForwarderConfig({
              sinkType: "snowflake",
              config: {
                ...snowflakeEventForwarderConfig.config,
                accessUrl: e.target.value,
              },
            })
          }
        />
      </div>
      <div className="form-group col-md-12">
        <Button
          color="primary"
          disabled={!canTestEventForwarderAccess}
          loadingCta="Testing access"
          onClick={testEventForwarderAccess}
        >
          Test Write Access
        </Button>
      </div>
      {eventForwarderTestResult ? (
        <div className="form-group col-md-12">
          <Callout status={eventForwarderTestResult.status} mt="0" mb="0">
            {eventForwarderTestResult.message}
          </Callout>
        </div>
      ) : null}
    </>
  );
};

export default SnowflakeEventForwarderForm;
