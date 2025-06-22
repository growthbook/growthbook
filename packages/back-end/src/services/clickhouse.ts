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

type ClickHouseDataType =
  | "DateTime"
  | "Float64"
  | "Boolean"
  | "String"
  | "LowCardinality(String)";

// These will eventually move to be inside of attributes
const tempTopLevelFields: Record<string, ClickHouseDataType> = {
  user_id: "String",
  url: "String",
  url_path: "String",
  url_host: "String",
  url_query: "String",
  url_fragment: "String",
  device_id: "String",
  page_id: "String",
  session_id: "String",
  page_title: "String",
  utm_source: "String",
  utm_medium: "String",
  utm_campaign: "String",
  utm_term: "String",
  utm_content: "String",
  geo_country: "String",
  geo_city: "String",
  geo_lat: "Float64",
  geo_lon: "Float64",
  ua: "String",
  ua_browser: "String",
  ua_os: "String",
  ua_device_type: "String",
};

const REMAINING_COLUMNS_SCHEMA: Record<string, ClickHouseDataType> = {
  environment: "LowCardinality(String)",
  sdk_language: "LowCardinality(String)",
  sdk_version: "LowCardinality(String)",
  event_uuid: "String",
  ip: "String",
};

function clickhouseUserId(orgId: string) {
  return ENVIRONMENT === "production" ? `${orgId}` : `test_${orgId}`;
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

function getClickhouseDatatype(
  columnType: FactTableColumnType
): ClickHouseDataType {
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

function getClickhouseExtractClause(
  sourceField: string,
  columnType: FactTableColumnType
) {
  // Some fields will eventually be inside attributes instead of top-level
  // This is a temp workaround until then
  if (tempTopLevelFields[sourceField]) {
    const desiredDataType = getClickhouseDatatype(
      tempTopLevelFields[sourceField] as FactTableColumnType
    );

    // If the desired data type is different from the actual type, need to cast it
    if (desiredDataType !== tempTopLevelFields[sourceField]) {
      return `CAST(${sourceField} AS ${desiredDataType})`;
    }

    // Otherwise, just return the column name
    return sourceField;
  }

  switch (columnType) {
    case "number":
      return `JSONExtractFloat(context_json, '${sourceField}')`;
    case "boolean":
      return `JSONExtractBool(context_json, '${sourceField}')`;
    default:
      return `JSONExtractString(context_json, '${sourceField}')`;
  }
}

export function getReservedColumnNames(): Set<string> {
  return new Set(
    [
      "timestamp",
      "client_key",
      "event_name",
      "properties",
      "attributes",
      "experiment_id",
      "variation_id",
      ...Object.keys(REMAINING_COLUMNS_SCHEMA),
    ].map((col) => col.toLowerCase())
  );
}

function getEventMaterializedViewSQL(
  orgId: string,
  materializedColumns: MaterializedColumn[]
) {
  const select: string[] = [
    "timestamp",
    "client_key",
    "event_name",
    "properties_json as properties",
    "context_json as attributes",
    ...materializedColumns.map(
      ({ columnName, datatype, sourceField }) =>
        `${getClickhouseExtractClause(sourceField, datatype)} as ${columnName}`
    ),
    ...Object.keys(REMAINING_COLUMNS_SCHEMA),
  ];

  return `SELECT ${select.join(", ")}
    FROM ${CLICKHOUSE_MAIN_TABLE} 
    WHERE (organization = '${orgId}') AND (event_name NOT IN ('Feature Evaluated', 'Experiment Viewed'))`;
}

function getExposureMaterializedViewSQL(
  orgId: string,
  materializedColumns: MaterializedColumn[]
) {
  const select: string[] = [
    "timestamp",
    "client_key",
    "simpleJSONExtractString(properties_json, 'experimentId') as experiment_id",
    "simpleJSONExtractString(properties_json, 'variationId') as variation_id",
    "properties_json as properties",
    "context_json as attributes",
    ...materializedColumns.map(
      ({ columnName, datatype, sourceField }) =>
        `${getClickhouseExtractClause(sourceField, datatype)} as ${columnName}`
    ),
    ...Object.keys(REMAINING_COLUMNS_SCHEMA),
  ];

  return `SELECT ${select.join(", ")}
    FROM ${CLICKHOUSE_MAIN_TABLE} 
    WHERE (organization = '${orgId}') AND (event_name = 'Experiment Viewed')`;
}

export async function createClickhouseUser(
  context: ReqContext,
  materializedColumns: MaterializedColumn[] = []
): Promise<DataSourceParams> {
  const client = createAdminClickhouseClient();

  const orgId = context.org.id;
  const user = clickhouseUserId(orgId);
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
  const exposureTableName = `${database}.experiment_views`;
  const exposureViewName = `${database}.experiment_views_mv`;

  logger.info(`creating Clickhouse database ${database}`);
  await client.command({
    query: `CREATE DATABASE ${database}`,
  });

  logger.info(`Creating Clickhouse user ${user}`);
  await client.command({
    query: `CREATE USER ${user} IDENTIFIED WITH sha256_hash BY '${hashedPassword}' DEFAULT DATABASE ${database}`,
  });

  // Main events table
  logger.info(`Creating Clickhouse table ${eventsTableName}`);
  const tableCols: string[] = [
    "timestamp DateTime",
    "client_key String",
    "event_name String",
    "properties String",
    "attributes String",
    ...Object.entries(REMAINING_COLUMNS_SCHEMA).map(
      ([colName, colType]) => `${colName} ${colType}`
    ),
    ...materializedColumns.map(
      ({ columnName, datatype }) =>
        `${columnName} ${getClickhouseDatatype(datatype)}`
    ),
  ];
  await client.command({
    query: `CREATE TABLE ${eventsTableName} (
  ${tableCols.join(",\n  ")}
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(timestamp) 
ORDER BY (event_name, timestamp)`,
  });

  const eventsViewSQL = getEventMaterializedViewSQL(orgId, materializedColumns);

  logger.info(`Copying existing data to the events table`);
  await client.command({
    query: `INSERT INTO ${eventsTableName} ${eventsViewSQL}`,
  });

  logger.info(`Creating Clickhouse events materialized view ${eventsViewName}`);
  await client.command({
    query: `CREATE MATERIALIZED VIEW ${eventsViewName} TO ${eventsTableName} 
DEFINER=CURRENT_USER SQL SECURITY DEFINER
AS ${eventsViewSQL}`,
  });

  // Experiment views table
  logger.info(`Creating ${exposureTableName} table`);
  await client.command({
    query: `CREATE TABLE ${exposureTableName} (
timestamp DateTime,
client_key String,
experiment_id String,
variation_id String,
properties String,
attributes String,
${Object.entries(REMAINING_COLUMNS_SCHEMA)
  .map(([colName, colType]) => `${colName} ${colType}`)
  .join(",")}
${materializedColumns
  .map(
    ({ columnName, datatype }) =>
      `${columnName} ${getClickhouseDatatype(datatype)}`
  )
  .join(",")}
      )
  ENGINE = MergeTree
PARTITION BY toYYYYMM(timestamp)
ORDER BY (experiment_id, timestamp)
    `,
  });

  const exposureViewSQL = getExposureMaterializedViewSQL(
    orgId,
    materializedColumns
  );

  logger.info(`Copying existing data to the experiment views table`);
  await client.command({
    query: `INSERT INTO ${exposureTableName} ${exposureViewSQL}`,
  });

  logger.info(
    `Creating ${exposureViewName} materialized view for experiment views`
  );
  await client.command({
    query: `CREATE MATERIALIZED VIEW ${exposureViewName} TO ${exposureTableName} 
DEFINER=CURRENT_USER SQL SECURITY DEFINER
AS ${exposureViewSQL}`,
  });

  // Feature Usage table
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
attributes String,
 ${Object.entries(REMAINING_COLUMNS_SCHEMA)
   .map(([colName, colType]) => `${colName} ${colType}`)
   .join(",")}
      )
  ENGINE = MergeTree
PARTITION BY toYYYYMM(timestamp)
ORDER BY (feature, timestamp)
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
    context_json as attributes,
    ${Object.keys(REMAINING_COLUMNS_SCHEMA).join(",")}
FROM ${CLICKHOUSE_MAIN_TABLE}
WHERE (organization = '${orgId}') AND (event_name = 'Feature Evaluated')`;

  logger.info(`Copying existing data to the feature usage table`);
  await client.command({
    query: `INSERT INTO ${featureUsageTableName} ${featureUsageMaterializedViewSql}`,
  });

  logger.info(`Creating ${featureUsageViewName} materialized view`);
  await client.command({
    query: `CREATE MATERIALIZED VIEW ${featureUsageViewName} TO ${featureUsageTableName}
DEFINER=CURRENT_USER SQL SECURITY DEFINER
AS ${featureUsageMaterializedViewSql}`,
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

export async function deleteClickhouseUser(organization: string) {
  const client = createAdminClickhouseClient();
  const user = clickhouseUserId(organization);

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
  columnsToAdd,
  columnsToDelete,
  columnsToRename,
  finalColumns,
  originalColumns,
}: {
  datasource: GrowthbookClickhouseDataSource;
  columnsToAdd: MaterializedColumn[];
  columnsToDelete: string[];
  columnsToRename: { from: string; to: string }[];
  finalColumns: MaterializedColumn[];
  originalColumns: MaterializedColumn[];
}) {
  const client = createAdminClickhouseClient();

  const orgId = datasource.organization;
  const database = clickhouseUserId(orgId);
  const eventsTableName = `${database}.events`;
  const eventsViewName = `${database}.events_mv`;
  const exposureTableName = `${database}.experiment_views`;
  const exposureViewName = `${database}.experiment_views_mv`;

  const addClauses = columnsToAdd
    .map(
      ({ columnName, datatype }) =>
        `ADD COLUMN IF NOT EXISTS ${columnName} ${getClickhouseDatatype(
          datatype
        )}`
    )
    .join(", ");
  const dropClauses = columnsToDelete
    .map((columnName) => `DROP COLUMN IF EXISTS ${columnName}`)
    .join(", ");
  const renameClauses = columnsToRename
    .map(({ from, to }) => `RENAME COLUMN ${from} to ${to}`)
    .join(", ");
  const clauses = `${addClauses}${
    columnsToAdd.length > 0 &&
    columnsToDelete.length + columnsToRename.length > 0
      ? ", "
      : ""
  }${dropClauses}${
    columnsToDelete.length > 0 && columnsToRename.length > 0 ? ", " : ""
  }${renameClauses}`;

  // Track which columns the view should be recreated with in case of an error
  let viewColumns = originalColumns;

  // First update the main events table
  logger.info(`Updating materialized columns; dropping view ${eventsViewName}`);
  await client.command({ query: `DROP VIEW IF EXISTS ${eventsViewName}` });
  let err = undefined;
  try {
    logger.info(`Updating table schema for ${eventsTableName}`);
    await client.command({
      query: `ALTER TABLE ${eventsTableName} ${clauses}`,
    });
    viewColumns = finalColumns;
  } catch (e) {
    logger.error(e);
    err = e;
  } finally {
    logger.info(`Recreating materialized view ${eventsViewName}`);
    const eventsViewSQL = getEventMaterializedViewSQL(orgId, viewColumns);
    await client.command({
      query: `CREATE MATERIALIZED VIEW ${eventsViewName} TO ${eventsTableName} 
DEFINER=CURRENT_USER SQL SECURITY DEFINER
AS ${eventsViewSQL}`,
    });
  }
  if (err) {
    throw err;
  }

  // Now update the experiment views table
  logger.info(
    `Updating materialized columns; dropping view ${exposureViewName}`
  );
  await client.command({ query: `DROP VIEW IF EXISTS ${exposureViewName}` });
  err = undefined;
  viewColumns = originalColumns;
  try {
    logger.info(`Updating table schema for ${exposureTableName}`);
    await client.command({
      query: `ALTER TABLE ${exposureTableName} ${clauses}`,
    });
    viewColumns = finalColumns;
  } catch (e) {
    logger.error(e);
    err = e;
  } finally {
    logger.info(`Recreating materialized view ${exposureViewName}`);
    const exposureViewSQL = getExposureMaterializedViewSQL(orgId, viewColumns);
    await client.command({
      query: `CREATE MATERIALIZED VIEW ${exposureViewName} TO ${exposureTableName}
AS ${exposureViewSQL}`,
    });
  }
  if (err) {
    throw err;
  }
}
