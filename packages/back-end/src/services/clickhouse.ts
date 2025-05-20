import * as crypto from "crypto";
import { createClient as createClickhouseClient } from "@clickhouse/client";
import generator from "generate-password";
import {
  CLICKHOUSE_HOST,
  CLICKHOUSE_ADMIN_USER,
  CLICKHOUSE_ADMIN_PASSWORD,
  CLICKHOUSE_DATABASE,
  CLICKHOUSE_MAIN_TABLE,
  ENVIRONMENT,
} from "back-end/src/util/secrets";
import {
  GrowthbookClickhouseDataSource,
  DataSourceParams,
  MaterializedColumn,
} from "back-end/types/datasource";
import { DailyUsage, ReqContext } from "back-end/types/organization";
import { logger } from "back-end/src/util/logger";
import { SDKConnectionInterface } from "back-end/types/sdk-connection";
import { FactTableColumnType } from "back-end/types/fact-table";

const REMAINING_COLUMNS_SCHEMA = {
  environment: "String",
  user_id: "String",
  context_json: "String",
  url: "String",
  url_path: "String",
  url_host: "String",
  url_query: "String",
  url_fragment: "String",
  device_id: "String",
  page_id: "String",
  session_id: "String",
  sdk_language: "String",
  sdk_version: "String",
  page_title: "String",
  utm_source: "String",
  utm_medium: "String",
  utm_campaign: "String",
  utm_term: "String",
  utm_content: "String",
  event_uuid: "String",
  ip: "String",
  geo_country: "String",
  geo_city: "String",
  geo_lat: "Float64",
  geo_lon: "Float64",
  ua: "String",
  ua_browser: "LowCardinality(String)",
  ua_os: "LowCardinality(String)",
  ua_device_type: "LowCardinality(String)",
};

function clickhouseUserId(orgId: string, datasourceId: string) {
  return ENVIRONMENT === "production"
    ? `${orgId}_${datasourceId}`
    : `test_${orgId}_${datasourceId}`;
}

function ensureClickhouseEnvVars() {
  if (
    !CLICKHOUSE_HOST ||
    !CLICKHOUSE_ADMIN_USER ||
    !CLICKHOUSE_ADMIN_PASSWORD ||
    !CLICKHOUSE_DATABASE ||
    !CLICKHOUSE_MAIN_TABLE
  ) {
    throw new Error(
      "Must specify necessary environment variables to interact with clickhouse."
    );
  }
}

function createAdminClickhouseClient() {
  ensureClickhouseEnvVars();
  return createClickhouseClient({
    host: CLICKHOUSE_HOST,
    username: CLICKHOUSE_ADMIN_USER,
    password: CLICKHOUSE_ADMIN_PASSWORD,
    database: CLICKHOUSE_DATABASE,
    application: "GrowthBook",
    request_timeout: 3620_000,
    clickhouse_settings: {
      max_execution_time: 3600,
    },
  });
}

function getClickhouseDatatype(columnType: FactTableColumnType) {
  switch (columnType) {
    case "date":
      return "DateTime";
    case "number":
      return "Float64";
    case "boolean":
      return "Boolean";
    default:
      return "String";
  }
}

function getClickhouseExtractFn(columnType: FactTableColumnType) {
  switch (columnType) {
    case "number":
      return "JSONExtractFloat";
    case "boolean":
      return "JSONExtractBool";
    default:
      return "JSONExtractString";
  }
}

export async function createClickhouseUser(
  context: ReqContext,
  datasourceId: string
): Promise<DataSourceParams> {
  const client = createAdminClickhouseClient();

  const orgId = context.org.id;
  const user = clickhouseUserId(orgId, datasourceId);
  const password = generator.generate({
    length: 30,
    numbers: true,
  });
  const hashedPassword = crypto
    .createHash("sha256")
    .update(password)
    .digest("hex");

  const database = user;
  const eventsTableName = `${database}.events`;
  const eventsViewName = `${database}.events_mv`;
  const featureUsageTableName = `${database}.feature_usage`;
  const featureUsageViewName = `${database}.feature_usage_mv`;

  logger.info(`creating Clickhouse database ${database}`);
  await client.command({
    query: `CREATE DATABASE ${database}`,
  });

  logger.info(`Creating Clickhouse user ${user}`);
  await client.command({
    query: `CREATE USER ${user} IDENTIFIED WITH sha256_hash BY '${hashedPassword}' DEFAULT DATABASE ${database}`,
  });

  logger.info(`Creating Clickhouse table ${eventsTableName}`);
  await client.command({
    query: `CREATE TABLE ${eventsTableName} (
timestamp DateTime,
client_key String,
event_name String,
properties_json String,
${Object.entries(REMAINING_COLUMNS_SCHEMA)
  .map(([colName, colType]) => `${colName} ${colType}`)
  .join(",")}
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(timestamp) 
ORDER BY (timestamp)`,
  });

  const eventsMaterializedViewSql = `SELECT 
    timestamp,
    client_key,
    event_name,
    properties_json,
    ${Object.keys(REMAINING_COLUMNS_SCHEMA).join(",")}
FROM ${CLICKHOUSE_MAIN_TABLE} 
WHERE (organization = '${orgId}') AND (event_name != 'Feature Evaluated')`;

  logger.info(`Creating Clickhouse events materialized view ${eventsViewName}`);
  await client.command({
    query: `CREATE MATERIALIZED VIEW ${eventsViewName} TO ${eventsTableName} 
DEFINER=CURRENT_USER SQL SECURITY DEFINER
AS ${eventsMaterializedViewSql}`,
  });

  logger.info(`Copying existing data to the events materialized view`);
  await client.command({
    query: `INSERT INTO ${eventsViewName} ${eventsMaterializedViewSql}`,
  });

  logger.info(`Creating ${featureUsageTableName} table`);
  await client.command({
    query: `CREATE TABLE ${featureUsageTableName} (
timestamp DateTime,
client_key String,
feature String,
revision String,
source String,
value String,
ruleId String,
variationId String,
 ${Object.entries(REMAINING_COLUMNS_SCHEMA)
   .map(([colName, colType]) => `${colName} ${colType}`)
   .join(",")}
      )
  ENGINE = MergeTree
PARTITION BY toYYYYMM(timestamp)
ORDER BY timestamp
    `,
  });

  const featureUsageMaterializedViewSql = `SELECT
    timestamp,
    client_key,
    JSONExtractString(properties_json, 'feature') as feature,
    JSONExtractString(properties_json, 'revision') as revision,
    JSONExtractString(properties_json, 'source') as source,
    JSONExtractString(properties_json, 'value') as value,
    JSONExtractString(properties_json, 'ruleId') as ruleId,
    JSONExtractString(properties_json, 'variationId') as variationId,
    ${Object.keys(REMAINING_COLUMNS_SCHEMA).join(",")}
FROM ${CLICKHOUSE_MAIN_TABLE}
WHERE (organization = '${orgId}') AND (event_name = 'Feature Evaluated')`;

  logger.info(`Creating ${featureUsageViewName} materialized view`);
  await client.command({
    query: `CREATE MATERIALIZED VIEW ${featureUsageViewName} TO ${featureUsageTableName}
DEFINER=CURRENT_USER SQL SECURITY DEFINER
AS ${featureUsageMaterializedViewSql}`,
  });

  logger.info(`Copying existing data to the feature usage materialized view`);
  await client.command({
    query: `INSERT INTO ${featureUsageViewName} ${featureUsageMaterializedViewSql}`,
  });

  logger.info(`Granting select permissions on ${database}.* to ${user}`);
  await client.command({
    query: `GRANT SELECT ON ${database}.* TO ${user}`,
  });

  logger.info(
    `Granting select permissions on information_schema.columns to ${user}`
  );
  // For schema browser.  They can only see info on tables that they have select permissions on.
  await client.command({
    query: `GRANT SELECT(data_type, table_name, table_catalog, table_schema, column_name) ON information_schema.columns TO ${user}`,
  });

  logger.info(`Clickhouse user ${user} created`);

  const url = new URL(CLICKHOUSE_HOST);

  const params = {
    port: parseInt(url.port) || 9000,
    url: url.toString(),
    user: user,
    password: password,
    database: database,
  };

  return params;
}

export async function deleteClickhouseUser(
  datasourceId: string,
  organization: string
) {
  const client = createAdminClickhouseClient();
  const user = clickhouseUserId(organization, datasourceId);

  logger.info(`Deleting Clickhouse user ${user}`);
  await client.command({
    query: `DROP USER ${user}`,
  });

  logger.info(`Deleting Clickhouse database ${user}`);
  await client.command({
    query: `DROP DATABASE ${user}`,
  });

  logger.info(`Clickhouse user ${user} deleted`);
}

export async function addCloudSDKMapping(connection: SDKConnectionInterface) {
  const { key, organization } = connection;

  // This is not a fatal error, so just log instead of throwing
  try {
    const client = createAdminClickhouseClient();
    await client.insert({
      table: "usage.sdk_key_mapping",
      values: [{ key, organization }],
      format: "JSONEachRow",
    });
  } catch (e) {
    logger.error(
      e,
      `Error inserting sdk key mapping (${key} -> ${organization})`
    );
  }
}

export async function getDailyCDNUsageForOrg(
  orgId: string,
  start: Date,
  end: Date
): Promise<DailyUsage[]> {
  const client = createAdminClickhouseClient();

  // orgId is coming from the back-end, so this should not be necessary, but just in case
  const sanitizedOrgId = orgId.replace(/[^a-zA-Z0-9_-]/g, "");

  const startString = start.toISOString().replace("T", " ").substring(0, 19);
  const endString = end.toISOString().replace("T", " ").substring(0, 19);

  // Don't fill forward beyond the current date
  const fillEnd = end > new Date() ? new Date() : end;
  const fillEndString = fillEnd
    .toISOString()
    .replace("T", " ")
    .substring(0, 19);

  const sql = `
select
  toStartOfDay(hour) as date,
  sum(requests) as requests,
  sum(bandwidth) as bandwidth
from usage.cdn_hourly
where
  organization = '${sanitizedOrgId}'
  AND date BETWEEN '${startString}' AND '${endString}'
group by date
order by date ASC
WITH FILL
  FROM toDateTime('${startString}')
  TO toDateTime('${fillEndString}')
  STEP toIntervalDay(1)
  `.trim();

  const res = await client.query({
    query: sql,
    format: "JSONEachRow",
  });

  const data: {
    date: string;
    // These are returned as strings because they could in theory be bigger than MAX_SAFE_INTEGER
    // That is very unlikely, and even if it happens it will still be approximately correct
    requests: string;
    bandwidth: string;
  }[] = await res.json();

  // Convert strings to numbers for requests/bandwidth
  return data.map((d) => ({
    date: d.date,
    requests: parseInt(d.requests) || 0,
    bandwidth: parseInt(d.bandwidth) || 0,
  }));
}

export async function updateMaterializedColumns({
  datasource,
  sanitizedToAdd,
  sanitizedToDelete,
  sanitizedToRename,
  sanitizedAllColumns,
}: {
  datasource: GrowthbookClickhouseDataSource;
  sanitizedToAdd: MaterializedColumn[];
  sanitizedToDelete: MaterializedColumn[];
  sanitizedToRename: { from: string; to: string }[];
  sanitizedAllColumns: MaterializedColumn[];
}) {
  const client = createAdminClickhouseClient();

  const orgId = datasource.organization;
  const database = clickhouseUserId(orgId, datasource.id);
  const eventsTableName = `${database}.events`;
  const eventsViewName = `${database}.events_mv`;

  logger.info(`Updating materialized columns; dropping view ${eventsViewName}`);
  await client.command({ query: `DROP VIEW ${eventsViewName}` });
  const addClauses = sanitizedToAdd
    .map(
      ({ columnName, datatype }) =>
        `ADD COLUMN IF NOT EXISTS ${columnName} ${getClickhouseDatatype(
          datatype
        )}`
    )
    .join(", ");
  const dropClauses = sanitizedToDelete
    .map(({ columnName }) => `DROP COLUMN IF EXISTS ${columnName}`)
    .join(", ");
  const renameClauses = sanitizedToRename
    .map(({ from, to }) => `RENAME COLUMN ${from} to ${to}`)
    .join(", ");
  const clauses = `${addClauses}${
    sanitizedToAdd.length > 0 &&
    sanitizedToDelete.length + sanitizedToRename.length > 0
      ? ", "
      : ""
  }${dropClauses}${
    sanitizedToDelete.length > 0 && sanitizedToRename.length > 0 ? ", " : ""
  }${renameClauses}`;
  logger.info(`Updating table schema for ${eventsTableName}`);
  await client.command({
    query: `ALTER TABLE ${eventsTableName} ${clauses}`,
  });

  logger.info(`Recreating materialized view ${eventsViewName}`);
  await client.command({
    query: `CREATE MATERIALIZED VIEW ${eventsViewName} TO ${eventsTableName} 
DEFINER=CURRENT_USER SQL SECURITY DEFINER
AS SELECT 
    timestamp,
    client_key,
    event_name,
    properties_json,
    ${
      sanitizedAllColumns
        .map(
          ({ columnName, datatype, sourceField }) =>
            `${getClickhouseExtractFn(
              datatype
            )}(context_json, '${sourceField}') as ${columnName}`
        )
        .join(", ") + (sanitizedAllColumns.length > 0 ? "," : "")
    }
${Object.keys(REMAINING_COLUMNS_SCHEMA).join(",")}
FROM ${CLICKHOUSE_MAIN_TABLE} 
WHERE (organization = '${orgId}') AND (event_name != 'Feature Evaluated')`,
  });
}
