import { DataSourceParams, DataSourceType } from "shared/types/datasource";
import {
  EventForwarderConfigDraft,
  EventForwarderConfigWithMetadata,
} from "shared/types/event-forwarder";
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

/**
 * Builds the draft for retrying or finishing an already-existing forwarder
 * (Finish Setting Up's "Configure Event Forwarder" step edits the
 * destination only). Prefers the project, database/role/warehouse, or
 * catalog already saved on the forwarder over ones freshly derived from the
 * datasource's current connection params, so retrying after an unrelated
 * connection-param change (e.g. a different default project) doesn't
 * silently move the forwarder to a different project or database. The
 * Snowflake URL is the exception: the write test connects with the current
 * connection, so a saved URL would pair the old host with the corrected
 * credentials. Falls back to the freshly derived values when nothing was
 * saved yet — a forwarder that never got as far as a real destination has
 * nothing to preserve, so this behaves like a brand-new connect flow.
 */
export function buildEventForwarderRetryDraft({
  type,
  params,
  eventForwarderConfig,
  destination,
  region,
}: {
  type: DataSourceType;
  params: Partial<DataSourceParams> | undefined;
  eventForwarderConfig: EventForwarderConfigWithMetadata | null | undefined;
  destination: EventForwarderDestination;
  region: DataRegion | null;
}): EventForwarderConfigDraft | null {
  const fresh = buildEventForwarderConnectDraft({
    type,
    params,
    destination,
    region,
  });
  if (!fresh || eventForwarderConfig?.sinkType !== fresh.sinkType) {
    return fresh;
  }

  if (
    fresh.sinkType === "bigquery" &&
    eventForwarderConfig.sinkType === "bigquery"
  ) {
    return {
      ...fresh,
      config: {
        ...fresh.config,
        projectId:
          eventForwarderConfig.config.projectId?.trim() ||
          fresh.config.projectId,
      },
    };
  }
  if (
    fresh.sinkType === "snowflake" &&
    eventForwarderConfig.sinkType === "snowflake"
  ) {
    return {
      ...fresh,
      config: {
        ...fresh.config,
        database:
          eventForwarderConfig.config.database?.trim() || fresh.config.database,
        role: eventForwarderConfig.config.role?.trim() || fresh.config.role,
        warehouse:
          eventForwarderConfig.config.warehouse?.trim() ||
          fresh.config.warehouse,
      },
    };
  }
  if (
    fresh.sinkType === "databricks" &&
    eventForwarderConfig.sinkType === "databricks"
  ) {
    return {
      ...fresh,
      config: {
        ...fresh.config,
        catalog:
          eventForwarderConfig.config.catalog?.trim() || fresh.config.catalog,
      },
    };
  }
  return fresh;
}
