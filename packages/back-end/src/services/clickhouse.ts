import { MANAGED_WAREHOUSE_EVENTS_FACT_TABLE_ID } from "shared/constants";
import { isManagedWarehouseAwaitingProvisioning } from "shared/util";
import {
  GrowthbookClickhouseDataSource,
  MaterializedColumn,
} from "shared/types/datasource";
import type { ReqContext } from "back-end/types/request";
import {
  getFactTablesForDatasource,
  updateFactTableColumns,
} from "back-end/src/models/FactTableModel";
import { updateMaterializedColumnsInClickhouse } from "back-end/src/services/licenseServerManagedClickhouse";

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
  attributes: Record<string, string>;
  experiments: [string, string][];
  flags: Record<string, string>;
  country: string;
  user_agent: string;
  device: string;
  browser: string;
  state: "recording" | "finalized" | "deleted";
  created_at: string;
};

export async function createSessionReplayTable(): Promise<void> {
  const client = createAdminClickhouseClient();
  // NOTE: IF NOT EXISTS won't update an existing table — drop manually in ClickHouse
  // when the schema changes during development:
  //   DROP TABLE local_sample.session_replays
  await runCommand(
    client,
    `CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.session_replays (
      session_id        String,
      org_id            String,
      client_key        String,
      user_id           String,
      s3_key            String,
      started_at        DateTime64(3),
      ended_at          DateTime64(3),
      last_event_at     DateTime64(3),
      duration_ms       UInt32,
      event_count       UInt32,
      error_count       UInt16,
      url_first         String,
      urls_visited      Array(String),
      attributes        Map(String, String),
      experiments       Array(Tuple(String, String)),
      flags             Map(String, String),
      country           String,
      user_agent        String,
      device            String,
      browser           String,
      state             Enum8('recording' = 1, 'finalized' = 2, 'deleted' = 3),
      created_at        DateTime64(3) DEFAULT now64(3)
    ) ENGINE = MergeTree()
    ORDER BY (org_id, created_at)`,
  );
}

export async function insertSessionReplayMetadata(row: {
  session_id: string;
  org_id: string;
  client_key: string;
  user_id: string;
  s3_key: string;
  started_at: Date;
  ended_at: Date;
  duration_ms: number;
  event_count: number;
  url_first: string;
  urls_visited: string[];
  attributes: Record<string, string>;
  experiments: [string, string][];
  flags: Record<string, string>;
  user_agent: string;
}): Promise<void> {
  const toDateTime64 = (d: Date) =>
    d.toISOString().replace("T", " ").replace("Z", "");

  const client = createAdminClickhouseClient();
  await client.insert({
    table: `${CLICKHOUSE_DATABASE}.session_replays`,
    values: [
      {
        session_id: row.session_id,
        org_id: row.org_id,
        client_key: row.client_key,
        user_id: row.user_id,
        s3_key: row.s3_key,
        started_at: toDateTime64(row.started_at),
        ended_at: toDateTime64(row.ended_at),
        last_event_at: toDateTime64(row.ended_at),
        duration_ms: row.duration_ms,
        event_count: row.event_count,
        error_count: 0,
        url_first: row.url_first,
        urls_visited: row.urls_visited,
        attributes: row.attributes,
        experiments: row.experiments,
        flags: row.flags,
        country: "",
        user_agent: row.user_agent,
        device: "",
        browser: "",
        state: "recording",
      },
    ],
    format: "JSONEachRow",
  });
}

export async function listSessionReplays(
  orgId: string,
): Promise<SessionReplayRow[]> {
  const client = createAdminClickhouseClient();
  // orgId comes from the authenticated back-end context, sanitize defensively
  const sanitizedOrgId = orgId.replace(/[^a-zA-Z0-9_-]/g, "");
  const result = await client.query({
    query: `SELECT *
            FROM ${CLICKHOUSE_DATABASE}.session_replays
            WHERE org_id = '${sanitizedOrgId}'
            ORDER BY created_at DESC
            LIMIT 100`,
    format: "JSONEachRow",
  });
  return result.json<SessionReplayRow>();
}

export async function getSessionReplayBySessionId(
  orgId: string,
  sessionId: string,
): Promise<SessionReplayRow | null> {
  const client = createAdminClickhouseClient();
  const sanitizedOrgId = orgId.replace(/[^a-zA-Z0-9_-]/g, "");
  const sanitizedSessionId = sessionId.replace(/[^a-zA-Z0-9_-]/g, "");
  const result = await client.query({
    query: `SELECT *
            FROM ${CLICKHOUSE_DATABASE}.session_replays
            WHERE org_id = '${sanitizedOrgId}' AND session_id = '${sanitizedSessionId}'
            LIMIT 1`,
    format: "JSONEachRow",
  });
  const rows = await result.json<SessionReplayRow>();
  return rows[0] ?? null;
}
