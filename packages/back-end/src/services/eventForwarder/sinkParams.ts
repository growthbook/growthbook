import { BigQueryConnectionParams } from "shared/types/integrations/bigquery";
import { SnowflakeConnectionParams } from "shared/types/integrations/snowflake";
import {
  BigQueryEventForwarderStoredConfig,
  SnowflakeEventForwarderStoredConfig,
} from "shared/types/event-forwarder";
import { EventForwarderConfigInterface } from "shared/validators";
import {
  decryptEventForwarderConfigModel,
  getBigQueryEventForwarderTablePrefix,
  getSnowflakeEventForwarderTablePrefix,
} from "back-end/src/services/eventForwarder/config";

export type SinkQueryConnectionParams =
  | {
      sinkType: "bigquery";
      projectId: string;
      dataset: string;
      tablePrefix: string;
    }
  | {
      sinkType: "snowflake";
      database: string;
      schema: string;
      tablePrefix: string;
    };

export function buildSinkQueryConnectionParams(
  eventForwarderConfig: EventForwarderConfigInterface,
  connectionParams?: BigQueryConnectionParams | SnowflakeConnectionParams,
): SinkQueryConnectionParams | null {
  switch (eventForwarderConfig.sinkType) {
    case "bigquery": {
      const bigqueryParams = connectionParams as
        | BigQueryConnectionParams
        | undefined;
      const projectId =
        bigqueryParams?.defaultProject?.trim() ||
        bigqueryParams?.projectId?.trim() ||
        "";
      if (!projectId) {
        return null;
      }

      const decrypted =
        decryptEventForwarderConfigModel<BigQueryEventForwarderStoredConfig>(
          eventForwarderConfig,
        );

      return {
        sinkType: "bigquery",
        projectId,
        dataset: decrypted.dataset.trim(),
        tablePrefix: getBigQueryEventForwarderTablePrefix(decrypted),
      };
    }
    case "snowflake": {
      const decrypted =
        decryptEventForwarderConfigModel<SnowflakeEventForwarderStoredConfig>(
          eventForwarderConfig,
        );

      return {
        sinkType: "snowflake",
        database: decrypted.database.trim(),
        schema: decrypted.schema.trim(),
        tablePrefix: getSnowflakeEventForwarderTablePrefix(decrypted),
      };
    }
    default:
      return null;
  }
}

export function buildExposureQueryParams(
  eventForwarderConfig: EventForwarderConfigInterface,
  connectionParams?: BigQueryConnectionParams | SnowflakeConnectionParams,
) {
  return buildSinkQueryConnectionParams(eventForwarderConfig, connectionParams);
}

export function buildFeatureUsageQueryParams(
  eventForwarderConfig: EventForwarderConfigInterface,
  connectionParams?: BigQueryConnectionParams | SnowflakeConnectionParams,
) {
  return buildSinkQueryConnectionParams(eventForwarderConfig, connectionParams);
}
