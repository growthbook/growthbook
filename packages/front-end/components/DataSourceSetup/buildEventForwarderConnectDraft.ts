import { DataSourceParams, DataSourceType } from "shared/types/datasource";
import { EventForwarderConfigDraft } from "shared/types/event-forwarder";
import { BigQueryConnectionParams } from "shared/types/integrations/bigquery";
import { DatabricksConnectionParams } from "shared/types/integrations/databricks";
import { SnowflakeConnectionParams } from "shared/types/integrations/snowflake";
import {
  DataRegion,
  stripLeadingUtf8ByteOrderMark,
  tryDeriveSnowflakeAccessUrlFromAccount,
} from "shared/util";
import { EventForwarderDestination } from "./EventForwarderDestinationFields";

function isEventForwarderSink(
  type: DataSourceType,
): type is EventForwarderConfigDraft["sinkType"] {
  return type === "bigquery" || type === "snowflake" || type === "databricks";
}

export function buildEventForwarderConnectDraft({
  type,
  params,
  destination,
  region,
}: {
  type: DataSourceType;
  params: Partial<DataSourceParams> | undefined;
  destination: EventForwarderDestination;
  region: DataRegion | null;
}): EventForwarderConfigDraft | null {
  if (!isEventForwarderSink(type)) return null;
  const regionField = region ? { region } : {};

  if (type === "bigquery") {
    const bigQuery = (params || {}) as Partial<BigQueryConnectionParams>;
    const serviceAccountKey =
      stripLeadingUtf8ByteOrderMark(bigQuery.serviceAccountJson ?? "").trim() ||
      "";
    return {
      sinkType: "bigquery",
      ...regionField,
      config: {
        projectId:
          bigQuery.defaultProject?.trim() || bigQuery.projectId?.trim() || "",
        dataset: destination.location,
        tablePrefix: destination.tablePrefix,
        ...(serviceAccountKey ? { serviceAccountKey } : {}),
      },
    };
  }

  if (type === "snowflake") {
    const snowflake = (params || {}) as Partial<SnowflakeConnectionParams>;
    const accessUrl =
      snowflake.accessUrl?.trim() ||
      tryDeriveSnowflakeAccessUrlFromAccount(snowflake.account || "") ||
      "";
    const role = snowflake.role?.trim() || "";
    const warehouse = snowflake.warehouse?.trim() || "";
    return {
      sinkType: "snowflake",
      ...regionField,
      config: {
        database: snowflake.database?.trim() || "",
        schema: destination.location,
        tablePrefix: destination.tablePrefix,
        ...(accessUrl ? { accessUrl } : {}),
        ...(role ? { role } : {}),
        ...(warehouse ? { warehouse } : {}),
      },
    };
  }

  const databricks = (params || {}) as Partial<DatabricksConnectionParams>;
  return {
    sinkType: "databricks",
    ...regionField,
    config: {
      catalog: databricks.catalog?.trim() || "",
      schema: destination.location,
      tablePrefix: destination.tablePrefix,
      zerobusEndpoint: destination.zerobusEndpoint,
    },
  };
}
