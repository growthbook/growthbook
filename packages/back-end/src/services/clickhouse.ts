import { MANAGED_WAREHOUSE_EVENTS_FACT_TABLE_ID } from "shared/constants";
import { isManagedWarehouseAwaitingProvisioning } from "shared/util";
import {
  GrowthbookClickhouseDataSource,
  MaterializedColumn,
} from "shared/types/datasource";
import { DailyUsage } from "shared/types/organization";
import {
  CLICKHOUSE_HOST,
  CLICKHOUSE_ADMIN_USER,
  CLICKHOUSE_ADMIN_PASSWORD,
  CLICKHOUSE_DATABASE,
  CLICKHOUSE_MAIN_TABLE,
  CLICKHOUSE_SESSION_REPLAY_TABLE,
  ENVIRONMENT,
  IS_CLOUD,
  CLICKHOUSE_OVERAGE_TABLE,
  MANAGED_CLICKHOUSE_USE_LICENSE_SERVER,
} from "back-end/src/util/secrets";
import type { ReqContext } from "back-end/types/request";
import {
  getFactTablesForDatasource,
  updateFactTableColumns,
} from "back-end/src/models/FactTableModel";
import {
  getGrowthbookDatasource,
  lockDataSource,
  unlockDataSource,
} from "back-end/src/models/DataSourceModel";
import { getSourceIntegrationObject } from "back-end/src/services/datasource";
import SqlIntegration from "back-end/src/integrations/SqlIntegration";
import {
  addCloudSDKMapping as addCloudSDKMappingViaLicenseServer,
  createClickhouseUser as createClickhouseUserViaLicenseServer,
  dangerousRecreateClickhouseTables as dangerousRecreateClickhouseTablesViaLicenseServer,
  deleteClickhouseUser as deleteClickhouseUserViaLicenseServer,
  migrateOverageEventsForOrgId as migrateOverageEventsForOrgIdViaLicenseServer,
} from "back-end/src/services/licenseServerManagedClickhouse";

type ClickHouseDataType =
  | "DateTime"
  | "Float64"
  | "Boolean"
  | "String"
  | "LowCardinality(String)";

const REMAINING_COLUMNS_SCHEMA: Record<string, ClickHouseDataType> = {
  environment: "LowCardinality(String)",
  sdk_language: "LowCardinality(String)",
  sdk_version: "LowCardinality(String)",
  event_uuid: "String",
  ip: "String",
};

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

function getSessionReplaySQL(orgId: string): {
  createTable: string;
  createView: string;
  populateTable: string;
  tableName: string;
  viewName: string;
} {
  const tableName = getTableName(orgId, "session_replays");
  const viewName = getTableName(orgId, "session_replays_mv");

  const createTable = `CREATE TABLE ${tableName} (
  session_id       String,
  org_id           String,
  client_key       String,
  chunk_index      UInt32,
  user_id          String,
  s3_key           String,
  started_at       DateTime64(3),
  ended_at         DateTime64(3),
  last_event_at    DateTime64(3),
  duration_ms      UInt32,
  event_count      UInt32,
  error_count      UInt16,
  url_first        String,
  urls_visited     Array(String),
  attributes       String,
  experiments      String,
  flags            String,
  user_agent       String,
  country          LowCardinality(String),
  device           LowCardinality(String),
  browser          LowCardinality(String),
  state            LowCardinality(String),
  created_at       DateTime64(3)
) ENGINE = ReplacingMergeTree(chunk_index)
ORDER BY session_id`;

  const select = `SELECT
  session_id, org_id, client_key, chunk_index, user_id, s3_key,
  started_at, ended_at, last_event_at, duration_ms, event_count,
  error_count, url_first, urls_visited, attributes, experiments,
  flags, user_agent, country, device, browser, state,
  ingested_at AS created_at
FROM ${CLICKHOUSE_SESSION_REPLAY_TABLE}
WHERE org_id = '${orgId}'`;

  const populateTable = `INSERT INTO ${tableName} ${select}`;
  const createView = `CREATE MATERIALIZED VIEW ${viewName} TO ${tableName}
DEFINER=CURRENT_USER SQL SECURITY DEFINER
AS ${select}`;

  return { createTable, createView, populateTable, tableName, viewName };
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
  if (MANAGED_CLICKHOUSE_USE_LICENSE_SERVER) {
    return createClickhouseUserViaLicenseServer(
      context.org.id,
      materializedColumns,
    );
  }

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
    port: parseIntWithDefault(url.port, 9000),
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

  // Session replays table — only provisioned when the shared source table is configured
  if (CLICKHOUSE_SESSION_REPLAY_TABLE) {
    const sessionReplaySQL = getSessionReplaySQL(orgId);
    logger.info(`Creating table ${sessionReplaySQL.tableName}`);
    await runCommand(client, sessionReplaySQL.createTable);
    logger.info(`Populating table ${sessionReplaySQL.tableName}`);
    await runCommand(client, sessionReplaySQL.populateTable);
    logger.info(`Creating materialized view ${sessionReplaySQL.viewName}`);
    await runCommand(client, sessionReplaySQL.createView);
  }

  logger.info(`Granting select permissions on ${database}.* to ${user}`);
  await runCommand(client, `GRANT SELECT ON ${database}.* TO ${user}`);
}

export async function _dangerousRecreateClickhouseTables(
  context: ReqContext,
  datasource: GrowthbookClickhouseDataSource,
): Promise<void> {
  const orgId = context.org.id;

  // Backfilling data can take a while, so lock the datasource for 30 minutes
  await lockDataSource(context, datasource, 1800);

  try {
    if (MANAGED_CLICKHOUSE_USE_LICENSE_SERVER) {
      await dangerousRecreateClickhouseTablesViaLicenseServer(
        orgId,
        datasource.settings.materializedColumns || [],
      );
    } else {
      const client = createAdminClickhouseClient();
      const user = clickhouseUserId(orgId);
      const database = user;

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
    }
  } finally {
    await unlockDataSource(context, datasource);
  }
}

/**
 * Creates the session-replay materialized view for a single org if it does not
 * already exist. Safe to call on orgs provisioned before
 * CLICKHOUSE_SESSION_REPLAY_TABLE was set (i.e. the session_replays table
 * exists but the MV is missing). Does not backfill historical rows.
 */
export async function createSessionReplayMVIfMissing(
  orgId: string,
): Promise<void> {
  if (!CLICKHOUSE_SESSION_REPLAY_TABLE) return;
  const { createView, viewName } = getSessionReplaySQL(orgId);
  const client = createAdminClickhouseClient();
  const idempotentSQL = createView.replace(
    "CREATE MATERIALIZED VIEW ",
    "CREATE MATERIALIZED VIEW IF NOT EXISTS ",
  );
  logger.info(`Creating session-replay MV ${viewName} if missing`);
  await runCommand(client, idempotentSQL);
}

export async function deleteClickhouseUser(organization: string) {
  if (MANAGED_CLICKHOUSE_USE_LICENSE_SERVER) {
    return deleteClickhouseUserViaLicenseServer(organization);
  }

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
    if (MANAGED_CLICKHOUSE_USE_LICENSE_SERVER) {
      await addCloudSDKMappingViaLicenseServer(key, organization);
    } else {
      const client = createAdminClickhouseClient();
      await client.insert({
        table: "usage.sdk_key_mapping",
        values: [{ key, organization }],
        format: "JSONEachRow",
      });
    }
  } catch (e) {
    logger.error(
      e,
      `Error inserting sdk key mapping (${key} -> ${organization})`,
    );
  }
}

export async function migrateOverageEventsForOrgId(orgId: string) {
  if (MANAGED_CLICKHOUSE_USE_LICENSE_SERVER) {
    return migrateOverageEventsForOrgIdViaLicenseServer(orgId);
  }

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
    requests: parseIntWithDefault(d.requests, 0),
    bandwidth: parseIntWithDefault(d.bandwidth, 0),
    managedClickhouseEvents: parseIntWithDefault(d.managedClickhouseEvents, 0),
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
  if (isManagedWarehouseAwaitingProvisioning(datasource)) {
    return;
  }
  const orgId = datasource.organization;

  await updateMaterializedColumnsInClickhouse({
    orgId,
    columnsToAdd,
    columnsToDelete,
    columnsToRename,
    finalColumns,
    originalColumns,
  });

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
        const existingDestinationCol = newColumns.find((c) => c.column === to);
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
}

// --- Session Replay ---

export type SessionReplayRow = {
  session_id: string;
  org_id: string;
  client_key: string;
  user_id: string;
  s3_key: string;
  started_at: string;
  ended_at: string;
  last_event_at: string;
  duration_ms: number;
  event_count: number;
  error_count: number;
  url_first: string;
  urls_visited: string[];
  attributes: string; // JSON
  experiments: string; // JSON
  flags: string; // JSON
  country: string;
  user_agent: string;
  device: string;
  browser: string;
  state: "recording" | "finalized" | "deleted";
  created_at: string;
};

export async function listSessionReplays(
  context: ReqContext,
  options?: {
    userId?: string;
    clientKey?: string;
    state?: "recording" | "finalized" | "deleted";
    url?: string;
    limit?: number;
    offset?: number;
  },
): Promise<SessionReplayRow[]> {
  const datasource = await getGrowthbookDatasource(context);
  if (!datasource) return [];

  const integration = getSourceIntegrationObject(
    context,
    datasource,
  ) as SqlIntegration;
  const conditions: string[] = [];

  if (options?.userId) {
    conditions.push(`user_id = '${escapeClickhouseString(options.userId)}'`);
  }
  if (options?.clientKey) {
    conditions.push(
      `client_key = '${escapeClickhouseString(options.clientKey)}'`,
    );
  }
  if (options?.state) {
    conditions.push(`state = '${escapeClickhouseString(options.state)}'`);
  }
  if (options?.url) {
    conditions.push(
      `positionCaseInsensitive(url_first, ${toClickhouseStringLiteral(options.url)}) > 0`,
    );
  }

  const limit = Math.max(1, Math.min(100, Math.floor(options?.limit ?? 100)));
  const offset = Math.max(0, Math.floor(options?.offset ?? 0));
  const where =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  // Note: the per-org session-replay table is literally named
  // `session-replay-metadata` (hyphens — typo in central-license-server's
  // managedClickhouseProvisioning.ts `baseTableName`), so we backtick it.
  // It uses `ingested_at` (no `created_at` column), so we alias for the
  // existing `SessionReplayRow` shape.
  // Note: no FINAL — the license-server provisioning creates this as a plain
  // MergeTree (ClickHouse Cloud auto-promotes to SharedMergeTree, which
  // doesn't accept FINAL). The OLD per-org `session_replays` table was a
  // ReplacingMergeTree(chunk_index) where FINAL was needed to dedupe Kafka
  // redeliveries; the new MergeTree table doesn't dedupe at all (see deeper
  // note below).
  const { rows } = await integration.runQuery(`
    SELECT *, ingested_at AS created_at
    FROM \`session-replay-metadata\`
    ${where}
    ORDER BY ingested_at DESC
    LIMIT ${limit}
    OFFSET ${offset}
  `);

  return rows as unknown as SessionReplayRow[];
}

function escapeClickhouseString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function toClickhouseStringLiteral(value: string): string {
  return `'${escapeClickhouseString(value)}'`;
}

export async function getSessionReplayBySessionId(
  context: ReqContext,
  sessionId: string,
): Promise<SessionReplayRow | null> {
  const datasource = await getGrowthbookDatasource(context);
  if (!datasource) return null;

  const integration = getSourceIntegrationObject(
    context,
    datasource,
  ) as SqlIntegration;
  const sanitizedSessionId = sessionId.replace(/[^a-zA-Z0-9_-]/g, "");

  const { rows } = await integration.runQuery(`
    SELECT *, ingested_at AS created_at
    FROM \`session-replay-metadata\`
    WHERE session_id = '${sanitizedSessionId}'
    LIMIT 1
  `);

  const row = rows[0];
  return row ? (row as unknown as SessionReplayRow) : null;
}
