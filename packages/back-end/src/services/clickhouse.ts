import * as crypto from "crypto";
import { createClient as createClickhouseClient } from "@clickhouse/client";
import generator from "generate-password";
import { AIPromptType } from "shared/ai";
import { MANAGED_WAREHOUSE_EVENTS_FACT_TABLE_ID } from "shared/constants";
import { SDKConnectionInterface } from "shared/types/sdk-connection";
import {
  GrowthbookClickhouseDataSource,
  DataSourceParams,
  MaterializedColumn,
} from "shared/types/datasource";
import { DailyUsage } from "shared/types/organization";
import { ColumnInterface, FactTableColumnType } from "shared/types/fact-table";
import {
  CLICKHOUSE_HOST,
  CLICKHOUSE_ADMIN_USER,
  CLICKHOUSE_ADMIN_PASSWORD,
  CLICKHOUSE_DATABASE,
  CLICKHOUSE_MAIN_TABLE,
  ENVIRONMENT,
  IS_CLOUD,
  CLICKHOUSE_DEV_PREFIX,
  CLICKHOUSE_OVERAGE_TABLE,
} from "back-end/src/util/secrets";
import type { ReqContext } from "back-end/types/request";
import { logger } from "back-end/src/util/logger";
import {
  getFactTablesForDatasource,
  updateFactTableColumns,
} from "back-end/src/models/FactTableModel";
import {
  lockDataSource,
  unlockDataSource,
} from "back-end/src/models/DataSourceModel";

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
  // Sanity check. An orgId of `default` or another reserved word would seriously mess things up
  if (!orgId.startsWith("org_")) {
    throw new Error("Invalid organization id");
  }

  return ENVIRONMENT === "production"
    ? `${orgId}`
    : `${CLICKHOUSE_DEV_PREFIX}${orgId}`;
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
      "Must specify necessary environment variables to interact with clickhouse.",
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
  columnType: FactTableColumnType,
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
  columnType: FactTableColumnType,
) {
  // Some fields will eventually be inside attributes instead of top-level
  // This is a temp workaround until then
  if (tempTopLevelFields[sourceField]) {
    const desiredDataType = getClickhouseDatatype(columnType);

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
    ].map((col) => col.toLowerCase()),
  );
}

type ColumnDef = {
  source: string;
  alias?: string;
  datatype: ClickHouseDataType;
};

function getCreateTableColumnList(columns: ColumnDef[]): string[] {
  return columns.map(
    ({ source, alias, datatype }) => `${alias || source} ${datatype}`,
  );
}
function getSelectColumnList(columns: ColumnDef[]): string[] {
  return columns.map(
    ({ source, alias }) =>
      `${source}${alias && alias !== source ? ` as ${alias}` : ""}`,
  );
}

function getRemainingColumnDefs(): ColumnDef[] {
  return Object.entries(REMAINING_COLUMNS_SCHEMA).map(([colName, colType]) => ({
    source: colName,
    datatype: colType as ClickHouseDataType,
  }));
}

function getMaterializedColumnDefs(
  materializedColumns: MaterializedColumn[],
): ColumnDef[] {
  return materializedColumns.map(({ columnName, datatype, sourceField }) => ({
    source: getClickhouseExtractClause(sourceField, datatype),
    alias: columnName,
    datatype: getClickhouseDatatype(datatype),
  }));
}

function getMaterializedViewSQL({
  orgId,
  colDefs,
  orderBy,
  filter,
  baseTableName,
}: {
  orgId: string;
  colDefs: ColumnDef[];
  orderBy: string;
  filter: string;
  baseTableName: string;
}): {
  createTable: string;
  createView: string;
  populateTable: string;
  select: string;
  tableName: string;
  viewName: string;
} {
  const tableName = getTableName(orgId, baseTableName);
  const viewName = getTableName(orgId, `${baseTableName}_mv`);

  const createTable = `CREATE TABLE ${tableName} (
  ${getCreateTableColumnList(colDefs).join(",\n  ")}
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(timestamp) 
ORDER BY ${orderBy}`;

  const select = `SELECT ${getSelectColumnList(colDefs).join(", ")}
    FROM ${CLICKHOUSE_MAIN_TABLE} 
    WHERE (organization = '${orgId}') AND (${filter})`;

  const populateTable = `INSERT INTO ${tableName} ${select}`;
  const createView = `CREATE MATERIALIZED VIEW ${viewName} TO ${tableName} 
DEFINER=CURRENT_USER SQL SECURITY DEFINER
AS ${select}`;

  return {
    createTable,
    select,
    populateTable,
    createView,
    tableName,
    viewName,
  };
}

function getEventsSQL(
  orgId: string,
  materializedColumns: MaterializedColumn[],
) {
  return getMaterializedViewSQL({
    orgId,
    baseTableName: "events",
    filter: "event_name NOT IN ('Experiment Viewed', 'Feature Evaluated')",
    orderBy: "(event_name, timestamp)",
    colDefs: [
      { source: "timestamp", datatype: "DateTime" },
      { source: "client_key", datatype: "String" },
      { source: "event_name", datatype: "String" },
      { source: "properties_json", alias: "properties", datatype: "String" },
      { source: "context_json", alias: "attributes", datatype: "String" },
      ...getRemainingColumnDefs(),
      ...getMaterializedColumnDefs(materializedColumns),
    ],
  });
}

function getExperimentViewSQL(
  orgId: string,
  materializedColumns: MaterializedColumn[],
) {
  return getMaterializedViewSQL({
    orgId,
    baseTableName: "experiment_views",
    filter: "event_name = 'Experiment Viewed'",
    orderBy: "(experiment_id, timestamp)",
    colDefs: [
      { source: "timestamp", datatype: "DateTime" },
      { source: "client_key", datatype: "String" },
      {
        source: "JSONExtractString(properties_json, 'experimentId')",
        alias: "experiment_id",
        datatype: "String",
      },
      {
        source: "JSONExtractString(properties_json, 'variationId')",
        alias: "variation_id",
        datatype: "String",
      },
      { source: "properties_json", alias: "properties", datatype: "String" },
      { source: "context_json", alias: "attributes", datatype: "String" },
      ...getRemainingColumnDefs(),
      ...getMaterializedColumnDefs(materializedColumns),
    ],
  });
}

function getFeatureusageSQL(orgId: string) {
  return getMaterializedViewSQL({
    orgId,
    baseTableName: "feature_usage",
    filter: "event_name = 'Feature Evaluated'",
    orderBy: "(feature, timestamp)",
    colDefs: [
      { source: "timestamp", datatype: "DateTime" },
      { source: "client_key", datatype: "String" },
      {
        source: "JSONExtractString(properties_json, 'feature')",
        alias: "feature",
        datatype: "String",
      },
      {
        source: "JSONExtractString(properties_json, 'revision')",
        alias: "revision",
        datatype: "String",
      },
      {
        source: "JSONExtractString(properties_json, 'source')",
        alias: "source",
        datatype: "String",
      },
      {
        source: "JSONExtractString(properties_json, 'value')",
        alias: "value",
        datatype: "String",
      },
      {
        source: "JSONExtractString(properties_json, 'ruleId')",
        alias: "ruleId",
        datatype: "String",
      },
      {
        source: "JSONExtractString(properties_json, 'variationId')",
        alias: "variationId",
        datatype: "String",
      },
      { source: "context_json", alias: "attributes", datatype: "String" },
      ...getRemainingColumnDefs(),
    ],
  });
}

async function runCommand(
  client: ReturnType<typeof createClickhouseClient>,
  query: string,
): Promise<void> {
  await client.command({ query });
}

function getTableName(orgId: string, name: string) {
  const user = clickhouseUserId(orgId);
  const database = user;
  return `${database}.${name}`;
}

export async function createClickhouseUser(
  context: ReqContext,
  materializedColumns: MaterializedColumn[] = [],
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
  logger.info(`creating Clickhouse database ${database}`);
  // It's important this does not have "IF NOT EXISTS" to protect against race conditions
  await runCommand(client, `CREATE DATABASE ${database}`);

  logger.info(`Creating Clickhouse user ${user}`);
  await runCommand(
    client,
    `CREATE USER ${user} IDENTIFIED WITH sha256_hash BY '${hashedPassword}' DEFAULT DATABASE ${database}`,
  );

  await createClickhouseTables(client, orgId, materializedColumns);

  logger.info(
    `Granting select permissions on information_schema.columns to ${user}`,
  );
  // For schema browser.  They can only see info on tables that they have select permissions on.
  await runCommand(
    client,
    `GRANT SELECT(data_type, table_name, table_catalog, table_schema, column_name) ON information_schema.columns TO ${user}`,
  );

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

export async function createClickhouseTables(
  client: ReturnType<typeof createAdminClickhouseClient>,
  orgId: string,
  materializedColumns: MaterializedColumn[] = [],
): Promise<void> {
  const user = clickhouseUserId(orgId);
  const database = user;

  // Events table
  const eventsSQL = getEventsSQL(orgId, materializedColumns);
  logger.info(`Creating table ${eventsSQL.tableName}`);
  await runCommand(client, eventsSQL.createTable);
  logger.info(`Populating table ${eventsSQL.tableName}`);
  await runCommand(client, eventsSQL.populateTable);
  logger.info(`Creating materialized view ${eventsSQL.viewName}`);
  await runCommand(client, eventsSQL.createView);

  // Experiment views table
  const experimentViewSQL = getExperimentViewSQL(orgId, materializedColumns);
  logger.info(`Creating table ${experimentViewSQL.tableName}`);
  await runCommand(client, experimentViewSQL.createTable);
  logger.info(`Populating table ${experimentViewSQL.tableName}`);
  await runCommand(client, experimentViewSQL.populateTable);
  logger.info(`Creating materialized view ${experimentViewSQL.viewName}`);
  await runCommand(client, experimentViewSQL.createView);

  // Feature usage table
  const featureUsageSQL = getFeatureusageSQL(orgId);
  logger.info(`Creating table ${featureUsageSQL.tableName}`);
  await runCommand(client, featureUsageSQL.createTable);
  logger.info(`Populating table ${featureUsageSQL.tableName}`);
  await runCommand(client, featureUsageSQL.populateTable);
  logger.info(`Creating materialized view ${featureUsageSQL.viewName}`);
  await runCommand(client, featureUsageSQL.createView);

  logger.info(`Granting select permissions on ${database}.* to ${user}`);
  await runCommand(client, `GRANT SELECT ON ${database}.* TO ${user}`);
}

export async function _dangerousRecreateClickhouseTables(
  context: ReqContext,
  datasource: GrowthbookClickhouseDataSource,
): Promise<void> {
  const client = createAdminClickhouseClient();

  const orgId = context.org.id;
  const user = clickhouseUserId(orgId);
  const database = user;

  // Backfilling data can take a while, so lock the datasource for 30 minutes
  await lockDataSource(context, datasource, 1800);

  try {
    // Drop the entire database and recreate it
    logger.info(`Dropping Clickhouse database ${database}`);
    await runCommand(client, `DROP DATABASE IF EXISTS ${database}`);

    logger.info(`Creating Clickhouse database ${database}`);
    await runCommand(client, `CREATE DATABASE ${database}`);

    await createClickhouseTables(
      client,
      orgId,
      datasource.settings.materializedColumns || [],
    );
  } finally {
    await unlockDataSource(context, datasource);
  }
}

export async function deleteClickhouseUser(organization: string) {
  const client = createAdminClickhouseClient();
  const user = clickhouseUserId(organization);
  const database = user;

  logger.info(`Deleting Clickhouse user ${user}`);
  await runCommand(client, `DROP USER IF EXISTS ${user}`);

  logger.info(`Deleting Clickhouse database ${database}`);
  await runCommand(client, `DROP DATABASE IF EXISTS ${database}`);
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
      `Error inserting sdk key mapping (${key} -> ${organization})`,
    );
  }
}

export async function migrateOverageEventsForOrgId(orgId: string) {
  const client = createAdminClickhouseClient();
  await runCommand(
    client,
    `INSERT INTO ${CLICKHOUSE_MAIN_TABLE} SELECT * FROM ${CLICKHOUSE_OVERAGE_TABLE} WHERE organization = '${orgId}'`,
  );
  await runCommand(
    client,
    `ALTER TABLE ${CLICKHOUSE_OVERAGE_TABLE} DELETE WHERE organization = '${orgId}'`,
  );
}

// In order to monitor usage and quality of AI responses on cloud we log each request to AI agents
export async function logCloudAIUsage({
  organization,
  type,
  model,
  temperature,
  numPromptTokensUsed,
  numCompletionTokensUsed,
  usedDefaultPrompt,
}: {
  organization: string;
  model: string;
  numPromptTokensUsed?: number;
  numCompletionTokensUsed?: number;
  type: AIPromptType;
  temperature?: number;
  usedDefaultPrompt: boolean;
}): Promise<void> {
  if (!IS_CLOUD) {
    // This is only for cloud
    return;
  }

  const env = ENVIRONMENT === "production" ? "prod" : ENVIRONMENT;
  // As this is just for logging, there is no need to make this a fatal error if it fails
  try {
    const client = createAdminClickhouseClient();
    await client.insert({
      table: "usage.ai_usage",
      values: [
        {
          env,
          organization,
          type,
          model,
          num_prompt_tokens_used: numPromptTokensUsed,
          num_completion_tokens_used: numCompletionTokensUsed,
          temperature,
          used_default_prompt: usedDefaultPrompt,
          date_created: new Date(),
        },
      ],
      format: "JSONEachRow",
    });
  } catch (e) {
    logger.error(e, "Failed to log AI usage to Clickhouse");
  }
}

export async function getDailyUsageForOrg(
  orgId: string,
  start: Date,
  end: Date,
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
  date,
  sum(requests) as requests,
  sum(bandwidth) as bandwidth,
  sum(managedClickhouseEvents) as managedClickhouseEvents
from (
  select
    toStartOfDay(hour) as date,
    sum(requests) as requests,
    sum(bandwidth) as bandwidth,
    0 as managedClickhouseEvents
  from usage.cdn_hourly
  where
    organization = '${sanitizedOrgId}'
    AND date BETWEEN '${startString}' AND '${endString}'
  group by date
  
  union all
  
  select
    toStartOfDay(received_at) as date,
    0 as requests,
    0 as bandwidth,
    count(1) as managedClickhouseEvents
  from ${CLICKHOUSE_MAIN_TABLE}
  where
    organization = '${sanitizedOrgId}'
    AND received_at BETWEEN '${startString}' AND '${endString}'
  group by date
  
  union all
  
  select
    toStartOfDay(received_at) as date,
    0 as requests,
    0 as bandwidth,
    count(1) as managedClickhouseEvents
  from ${CLICKHOUSE_OVERAGE_TABLE}
  where
    organization = '${sanitizedOrgId}'
    AND received_at BETWEEN '${startString}' AND '${endString}'
  group by date
)
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
    managedClickhouseEvents: string;
  }[] = await res.json();

  // Convert strings to numbers for all metrics
  return data.map((d) => ({
    date: d.date,
    requests: parseInt(d.requests) || 0,
    bandwidth: parseInt(d.bandwidth) || 0,
    managedClickhouseEvents: parseInt(d.managedClickhouseEvents) || 0,
  }));
}

export async function updateMaterializedColumns({
  context,
  datasource,
  columnsToAdd,
  columnsToDelete,
  columnsToRename,
  finalColumns,
  originalColumns,
}: {
  context: ReqContext;
  datasource: GrowthbookClickhouseDataSource;
  columnsToAdd: MaterializedColumn[];
  columnsToDelete: string[];
  columnsToRename: { from: string; to: string }[];
  finalColumns: MaterializedColumn[];
  originalColumns: MaterializedColumn[];
}) {
  // We can only process one materialized column update at a time
  // This should be quick, but lock it 5 minutes just in case
  await lockDataSource(context, datasource, 300);

  try {
    const client = createAdminClickhouseClient();

    const orgId = datasource.organization;

    const addClauses = columnsToAdd
      .map(
        ({ columnName, datatype }) =>
          `ADD COLUMN IF NOT EXISTS ${columnName} ${getClickhouseDatatype(
            datatype,
          )}`,
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
    const { tableName: eventsTableName, viewName: eventsViewName } =
      getEventsSQL(orgId, []);
    logger.info(
      `Updating materialized columns; dropping view ${eventsViewName}`,
    );
    await runCommand(client, `DROP VIEW IF EXISTS ${eventsViewName}`);
    let err = undefined;
    try {
      logger.info(`Updating table schema for ${eventsTableName}`);
      await runCommand(client, `ALTER TABLE ${eventsTableName} ${clauses}`);
      viewColumns = finalColumns;
    } catch (e) {
      logger.error(e);
      err = e;
    } finally {
      logger.info(`Recreating materialized view ${eventsViewName}`);
      const eventsSQL = getEventsSQL(orgId, viewColumns);
      await runCommand(client, eventsSQL.createView);
    }
    if (err) {
      throw err;
    }

    // Now update the experiment views table
    const { tableName: exposureTableName, viewName: exposureViewName } =
      getExperimentViewSQL(orgId, []);
    logger.info(
      `Updating materialized columns; dropping view ${exposureViewName}`,
    );
    await runCommand(client, `DROP VIEW IF EXISTS ${exposureViewName}`);
    err = undefined;
    viewColumns = originalColumns;
    try {
      logger.info(`Updating table schema for ${exposureTableName}`);
      await runCommand(client, `ALTER TABLE ${exposureTableName} ${clauses}`);
      viewColumns = finalColumns;
    } catch (e) {
      logger.error(e);
      err = e;
    } finally {
      logger.info(`Recreating materialized view ${exposureViewName}`);
      const experimentViewSQL = getExperimentViewSQL(orgId, viewColumns);
      await runCommand(client, experimentViewSQL.createView);
    }
    if (err) {
      throw err;
    }

    // Update the main events fact table with the new columns
    const factTables = await getFactTablesForDatasource(context, datasource.id);
    const ft = factTables.find(
      (ft) => ft.id === MANAGED_WAREHOUSE_EVENTS_FACT_TABLE_ID,
    );
    if (ft) {
      const newColumns = [...ft.columns];
      newColumns.forEach((col) => {
        if (col.numberFormat === undefined) {
          col.numberFormat = "";
        }
      });

      columnsToAdd.forEach((col) => {
        const existingCol = newColumns.find((c) => c.column === col.columnName);
        if (!existingCol) {
          newColumns.push({
            column: col.columnName,
            name: col.columnName,
            datatype: col.datatype,
            dateCreated: new Date(),
            dateUpdated: new Date(),
            deleted: false,
            description: "",
            numberFormat: "",
          });
        } else {
          // If the column already exists but was previously removed, restore it.
          existingCol.deleted = false;
          existingCol.dateUpdated = new Date();
        }
      });
      columnsToRename.forEach(({ from, to }) => {
        const col = newColumns.find((c) => c.column === from);
        if (col) {
          const existingDestinationCol = newColumns.find(
            (c) => c.column === to,
          );
          // Destination already exists
          if (existingDestinationCol) {
            // Restore destination if it had been previously removed.
            existingDestinationCol.deleted = false;
            existingDestinationCol.dateUpdated = new Date();
            // Mark the old column as deleted.
            col.deleted = true;
            col.dateUpdated = new Date();
          } else {
            // Otherwise, rename in place
            col.column = to;
            col.name = to;
            col.dateUpdated = new Date();
          }
        }
      });
      columnsToDelete.forEach((name) => {
        const col = newColumns.find((c) => c.column === name);
        if (col) {
          col.deleted = true;
          col.dateUpdated = new Date();
        }
      });

      const newIdentifierTypes = finalColumns
        .filter((col) => col.type === "identifier")
        .map((col) => col.columnName);

      await updateFactTableColumns(
        ft,
        { columns: newColumns, userIdTypes: newIdentifierTypes },
        context,
      );
    }
  } finally {
    await unlockDataSource(context, datasource);
  }
}

export function getManagedWarehouseUserIdTypes(
  datasource: GrowthbookClickhouseDataSource,
  factTableId: string,
  columns: ColumnInterface[],
): string[] {
  if (factTableId !== MANAGED_WAREHOUSE_EVENTS_FACT_TABLE_ID) {
    throw new Error(
      "This function can only be called for managed warehouse datasource and fact table.",
    );
  }

  const activeColumns = new Set(
    columns.filter((c) => !c.deleted).map((c) => c.column),
  );

  return (datasource.settings.materializedColumns || [])
    .filter((c) => c.type === "identifier")
    .map((c) => c.columnName)
    .filter((id) => activeColumns.has(id));
}
