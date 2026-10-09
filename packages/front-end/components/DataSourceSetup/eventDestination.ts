import {
  DataRegion,
  databricksParamsSupportEventForwarder,
  DEFAULT_EVENT_FORWARDER_TABLE_PREFIX,
  getDatabricksEventForwarderAuthMessage,
  normalizeBigQueryTablePrefixForEventForwarder,
  normalizeDatabricksEventForwarderDestination,
  normalizeDatabricksEventForwarderZerobusEndpoint,
  normalizeSnowflakeEventForwarderAccessUrl,
  normalizeSnowflakeTablePrefixForEventForwarder,
  supportsEventForwarder,
  tryDeriveSnowflakeAccessUrlFromAccount,
} from "shared/util";
import {
  DataSourceInterfaceWithParams,
  DataSourceParams,
  DataSourceType,
} from "shared/types/datasource";
import { EventForwarderConfigDraft } from "shared/types/event-forwarder";
import { BigQueryConnectionParams } from "shared/types/integrations/bigquery";
import { DatabricksConnectionParams } from "shared/types/integrations/databricks";
import { SnowflakeConnectionParams } from "shared/types/integrations/snowflake";
import { DEFAULT_DATA_REGION } from "@/services/dataRegions";

export type EventDestinationFields = {
  location: string;
  tablePrefix: string;
  zerobusEndpoint: string;
};

function defaultTablePrefix(type: DataSourceType | undefined): string {
  return type === "snowflake"
    ? DEFAULT_EVENT_FORWARDER_TABLE_PREFIX.toUpperCase()
    : DEFAULT_EVENT_FORWARDER_TABLE_PREFIX;
}

function defaultLocation(type: DataSourceType | undefined): string {
  return type === "snowflake" ? "GROWTHBOOK_EVENTS" : "growthbook_events";
}

export function defaultEventDestination(
  type: DataSourceType | undefined,
): EventDestinationFields {
  return {
    location: defaultLocation(type),
    tablePrefix: defaultTablePrefix(type),
    zerobusEndpoint: "",
  };
}

export function eventDestinationFromDatasource(
  datasource: Partial<DataSourceInterfaceWithParams>,
): EventDestinationFields {
  const config = datasource.eventForwarderConfig;
  if (!config) return defaultEventDestination(datasource.type);

  if (config.sinkType === "bigquery") {
    return {
      location: config.config.dataset || "",
      tablePrefix: config.config.tablePrefix || defaultTablePrefix("bigquery"),
      zerobusEndpoint: "",
    };
  }

  return {
    location: config.config.schema || "",
    tablePrefix:
      config.config.tablePrefix || defaultTablePrefix(config.sinkType),
    zerobusEndpoint:
      config.sinkType === "databricks"
        ? config.config.zerobusEndpoint || ""
        : "",
  };
}

function validationMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function snowflakeAccessUrl(
  params: Partial<SnowflakeConnectionParams> | undefined,
): string {
  return (
    params?.accessUrl?.trim() ||
    tryDeriveSnowflakeAccessUrlFromAccount(params?.account || "") ||
    ""
  );
}

export function eventDestinationDescription(
  type: DataSourceType,
  params: DataSourceParams | undefined,
): string {
  if (type === "bigquery") {
    const bigQuery = params as Partial<BigQueryConnectionParams> | undefined;
    const project =
      bigQuery?.projectId?.trim() ||
      bigQuery?.defaultProject?.trim() ||
      "your BigQuery project";
    return `A dataset in ${project} where GrowthBook creates tables for forwarded events.`;
  }

  if (type === "databricks") {
    const databricks = params as
      | Partial<DatabricksConnectionParams>
      | undefined;
    const catalog = databricks?.catalog?.trim() || "your catalog";
    return `A schema in ${catalog} where GrowthBook creates tables for forwarded events.`;
  }

  const snowflake = params as Partial<SnowflakeConnectionParams> | undefined;
  const database = snowflake?.database?.trim() || "your database";
  return `A schema in ${database} where GrowthBook creates tables for forwarded events.`;
}

export function eventDestinationSaveBlocker({
  type,
  params,
  destination,
}: {
  type: DataSourceType | undefined;
  params: DataSourceParams | undefined;
  destination: EventDestinationFields;
}): string | null {
  if (!type || !supportsEventForwarder({ type })) return null;

  if (type === "bigquery") {
    const bigQuery = params as Partial<BigQueryConnectionParams> | undefined;
    const project =
      bigQuery?.projectId?.trim() || bigQuery?.defaultProject?.trim();
    if (!project) {
      return "Enter a BigQuery project on the connection to continue";
    }
    if (!destination.location.trim()) return "Enter a dataset to continue";
    try {
      normalizeBigQueryTablePrefixForEventForwarder(destination.tablePrefix);
    } catch (error) {
      return validationMessage(error, "Enter a valid table prefix");
    }
    return null;
  }

  if (type === "snowflake") {
    const snowflake = params as Partial<SnowflakeConnectionParams> | undefined;
    if ((snowflake?.authMethod ?? "password") !== "key-pair") {
      return "Use key-pair authentication on the Snowflake connection to continue";
    }
    if (!snowflake?.database?.trim()) {
      return "Enter a Snowflake database on the connection to continue";
    }
    if (!snowflake.role?.trim()) {
      return "Enter a Snowflake role on the connection to continue";
    }
    const accessUrl = snowflakeAccessUrl(snowflake);
    if (!accessUrl) {
      return "Enter a Snowflake access URL on the connection to continue";
    }
    try {
      normalizeSnowflakeEventForwarderAccessUrl(accessUrl);
    } catch (error) {
      return validationMessage(error, "Enter a valid Snowflake access URL");
    }
    if (!destination.location.trim()) return "Enter a schema to continue";
    try {
      normalizeSnowflakeTablePrefixForEventForwarder(destination.tablePrefix);
    } catch (error) {
      return validationMessage(error, "Enter a valid table prefix");
    }
    return null;
  }

  const databricks = params as Partial<DatabricksConnectionParams> | undefined;
  if (!databricksParamsSupportEventForwarder(databricks)) {
    return getDatabricksEventForwarderAuthMessage(databricks);
  }
  if (!databricks?.catalog?.trim()) {
    return "Enter a Databricks catalog on the connection to continue";
  }
  if (!destination.location.trim()) return "Enter a schema to continue";
  if (!destination.zerobusEndpoint.trim()) {
    return "Enter a Zerobus endpoint to continue";
  }
  try {
    normalizeDatabricksEventForwarderDestination({
      catalog: databricks.catalog,
      schema: destination.location,
      tablePrefix: destination.tablePrefix,
    });
    normalizeDatabricksEventForwarderZerobusEndpoint(
      destination.zerobusEndpoint,
    );
  } catch (error) {
    return validationMessage(error, "Check the event destination");
  }
  return null;
}

export function buildEventForwarderConfigDraft({
  type,
  params,
  destination,
  region,
}: {
  type: DataSourceType;
  params: DataSourceParams | undefined;
  destination: EventDestinationFields;
  region?: DataRegion;
}): EventForwarderConfigDraft | null {
  if (!supportsEventForwarder({ type })) return null;
  const resolvedRegion = region ?? DEFAULT_DATA_REGION;

  if (type === "bigquery") {
    const bigQuery = (params || {}) as Partial<BigQueryConnectionParams>;
    return {
      sinkType: "bigquery",
      region: resolvedRegion,
      config: {
        projectId:
          bigQuery.projectId?.trim() || bigQuery.defaultProject?.trim() || "",
        dataset: destination.location.trim(),
        tablePrefix:
          destination.tablePrefix.trim() ||
          DEFAULT_EVENT_FORWARDER_TABLE_PREFIX,
      },
    };
  }

  if (type === "snowflake") {
    const snowflake = (params || {}) as Partial<SnowflakeConnectionParams>;
    const accessUrl = snowflakeAccessUrl(snowflake);
    return {
      sinkType: "snowflake",
      region: resolvedRegion,
      config: {
        database: snowflake.database?.trim() || "",
        schema: destination.location.trim(),
        tablePrefix:
          destination.tablePrefix.trim() ||
          DEFAULT_EVENT_FORWARDER_TABLE_PREFIX.toUpperCase(),
        ...(accessUrl ? { accessUrl } : {}),
        ...(snowflake.role?.trim() ? { role: snowflake.role.trim() } : {}),
        ...(snowflake.warehouse?.trim()
          ? { warehouse: snowflake.warehouse.trim() }
          : {}),
      },
    };
  }

  const databricks = (params || {}) as Partial<DatabricksConnectionParams>;
  return {
    sinkType: "databricks",
    region: resolvedRegion,
    config: {
      catalog: databricks.catalog?.trim() || "",
      schema: destination.location.trim(),
      tablePrefix:
        destination.tablePrefix.trim() || DEFAULT_EVENT_FORWARDER_TABLE_PREFIX,
      zerobusEndpoint: destination.zerobusEndpoint.trim(),
    },
  };
}
