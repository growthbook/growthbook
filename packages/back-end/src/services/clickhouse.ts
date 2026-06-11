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
import { getGrowthbookDatasource } from "back-end/src/models/DataSourceModel";
import { getSourceIntegrationObject } from "back-end/src/services/datasource";
import SqlIntegration from "back-end/src/integrations/SqlIntegration";
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
  // The sessions view groups by session_replay_id (not session_id).
  session_replay_id: string;
  org_id: string;
  client_key: string;
  user_id: string;
  // Persistent device id from the autoAttributesPlugin gbuuid cookie.
  // Separate from user_id (the logged-in identity) — lets sessions be
  // grouped by browser across anonymous → authenticated transitions.
  device_id: string;
  s3_key: string;
  started_at: string;
  ended_at: string;
  last_event_at: string;
  duration_ms: number;
  event_count: number;
  error_count: number;
  url_first: string;
  urls_visited: string[];
  page_title: string;
  viewport_width: number;
  viewport_height: number;
  attributes: Record<string, string>;
  // Flat key arrays aggregated across all chunks by the sessions view.
  // Use these for filtering and list display. For full structured eval history
  // (with timestamps) query session_replay_metadata directly.
  feature_keys: string[];
  experiment_keys: string[];
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
    country?: string;
    device?: string;
    /** Inclusive lower bound in seconds */
    minDurationSecs?: number;
    /** Inclusive upper bound in seconds */
    maxDurationSecs?: number;
    minEventCount?: number;
    maxEventCount?: number;
    /** Filter to sessions where this feature flag was evaluated */
    featureKey?: string;
    /** Filter to sessions where this experiment was exposed */
    experimentKey?: string;
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
  if (options?.country) {
    conditions.push(`country = '${escapeClickhouseString(options.country)}'`);
  }
  if (options?.device) {
    conditions.push(`device = '${escapeClickhouseString(options.device)}'`);
  }
  if (options?.minDurationSecs !== undefined) {
    conditions.push(
      `duration_ms >= ${Math.round(options.minDurationSecs * 1000)}`,
    );
  }
  if (options?.maxDurationSecs !== undefined) {
    conditions.push(
      `duration_ms <= ${Math.round(options.maxDurationSecs * 1000)}`,
    );
  }
  if (options?.minEventCount !== undefined) {
    conditions.push(`event_count >= ${Math.round(options.minEventCount)}`);
  }
  if (options?.maxEventCount !== undefined) {
    conditions.push(`event_count <= ${Math.round(options.maxEventCount)}`);
  }
  if (options?.featureKey) {
    const escaped = escapeClickhouseString(options.featureKey);
    conditions.push(`has(feature_keys, '${escaped}')`);
  }
  if (options?.experimentKey) {
    const escaped = escapeClickhouseString(options.experimentKey);
    conditions.push(`has(experiment_keys, '${escaped}')`);
  }

  const limit = Math.max(1, Math.min(100, Math.floor(options?.limit ?? 100)));
  const offset = Math.max(0, Math.floor(options?.offset ?? 0));
  // Always exclude soft-deleted from the list; callers that explicitly want
  // them must use a future bulk-list-by-id endpoint that doesn't go through
  // this function. Add this BEFORE the user-supplied conditions so it can't
  // be overridden by an empty filter.
  const allConditions = ["deleted_at IS NULL", ...conditions];
  const where = `WHERE ${allConditions.join(" AND ")}`;

  const { rows } = await integration.runQuery(`
    SELECT *, ingested_at AS created_at
    FROM session_replay_sessions
    ${where}
    ORDER BY started_at DESC
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
    FROM session_replay_sessions
    WHERE session_replay_id = '${sanitizedSessionId}' AND deleted_at IS NULL
    LIMIT 1
  `);

  const row = rows[0];
  return row ? (row as unknown as SessionReplayRow) : null;
}
