import { MANAGED_WAREHOUSE_EVENTS_FACT_TABLE_ID } from "shared/constants";
import {
  buildManagedWarehouseEventsFactTableSql,
  buildManagedWarehouseExposureQueries,
  getManagedWarehouseEventsFactTableColumns,
  getManagedWarehouseTypedAttributeColumns,
  getManagedWarehouseUserIdTypes,
  getManagedWarehouseUserIdTypeSettings,
  isManagedWarehouseAwaitingProvisioning,
  isManagedWarehouseMigrating,
  MANAGED_WAREHOUSE_ATTRIBUTES_COLUMN,
  MANAGED_WAREHOUSE_RESERVED_COLUMN_NAMES,
} from "shared/util";
import {
  DataSourceInterface,
  GrowthbookClickhouseDataSource,
} from "shared/types/datasource";
import { SDKAttributeSchema } from "shared/types/organization";
import type {
  ExperimentEvalItem,
  FeatureEvalItem,
  SessionEventItem,
} from "shared/validators";
import { ColumnInterface } from "shared/types/fact-table";
import { isEqual } from "lodash";
import type { ReqContext } from "back-end/types/request";
import type { ApiReqContext } from "back-end/types/api";
import {
  dangerouslyGetFactTableByIdBypassPermission,
  dangerouslySyncManagedWarehouseFactTable,
} from "back-end/src/models/FactTableModel";
import {
  getGrowthbookDatasource,
  dangerouslyGetGrowthbookDatasourceBypassPermission,
  updateDataSource,
} from "back-end/src/models/DataSourceModel";
import { syncJsonErgonomicsInClickhouse } from "back-end/src/services/licenseServerManagedClickhouse";
import { getSourceIntegrationObject } from "back-end/src/services/datasource";
import SqlIntegration from "back-end/src/integrations/SqlIntegration";
import { logger } from "back-end/src/util/logger";

// --- Session Replay ---

export type SessionReplayRow = {
  session_replay_id: string;
  organization: string;
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
  // Use these for filtering and list display.
  feature_keys: string[];
  experiment_keys: string[];
  // Per-chunk structured eval/event history. Present on raw table rows,
  // absent from the sessions view. Merged across chunks in application
  // code for the detail view.
  feature_evals?: { items: FeatureEvalItem[] };
  experiment_evals?: { items: ExperimentEvalItem[] };
  session_events?: { items: SessionEventItem[] };
  country: string;
  user_agent: string;
  device: string;
  browser: string;
  created_at: string;
};

export async function listSessionReplays(
  context: ReqContext,
  options?: {
    userId?: string;
    clientKey?: string;
    /** Pre-filter to sessions from these SDK connection keys (permission scoping) */
    clientKeys?: string[];
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
  if (options?.clientKeys?.length) {
    const escaped = options.clientKeys
      .map((k) => `'${escapeClickhouseString(k)}'`)
      .join(", ");
    conditions.push(`client_key IN (${escaped})`);
  }
  if (options?.clientKey) {
    conditions.push(
      `client_key = '${escapeClickhouseString(options.clientKey)}'`,
    );
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

  const { rows } = await integration.runQuery(
    `
    SELECT *, ingested_at AS created_at
    FROM session_replay_sessions
    ${where}
    ORDER BY started_at DESC
    LIMIT ${limit}
    OFFSET ${offset}
  `,
    undefined,
    { queryType: "sessionReplayList" },
  );

  return rows as unknown as SessionReplayRow[];
}

function escapeClickhouseString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function toClickhouseStringLiteral(value: string): string {
  return `'${escapeClickhouseString(value)}'`;
}

export async function getSessionReplayChunksBySessionId(
  context: ReqContext,
  sessionId: string,
): Promise<SessionReplayRow[]> {
  const datasource = await getGrowthbookDatasource(context);
  if (!datasource) return [];

  const integration = getSourceIntegrationObject(
    context,
    datasource,
  ) as SqlIntegration;
  const sanitizedSessionId = sessionId.replace(/[^a-zA-Z0-9_-]/g, "");

  const { rows } = await integration.runQuery(
    `
    SELECT *, ingested_at AS created_at
    FROM session_replay_metadata
    WHERE session_replay_id = '${sanitizedSessionId}' AND deleted_at IS NULL
  `,
    undefined,
    { queryType: "sessionReplayDetail" },
  );

  return rows as unknown as SessionReplayRow[];
}

// Re-sync a JSON-column managed warehouse after the org's identifiers change:
// regenerates the datasource userIdTypes/exposure queries and the `ch_events` fact
// table so custom identifiers are aliased out of `attributes`. No-op for legacy
// (materialized-column) warehouses or when no managed warehouse exists.
export async function syncManagedWarehouseIdentifiers(
  context: ReqContext | ApiReqContext,
  // Pass the freshly-updated schema; context.org may still be stale post-mutation.
  attributeSchema: SDKAttributeSchema | undefined = context.org.settings
    ?.attributeSchema,
  // Optionally reconcile a specific (already-fetched) warehouse instead of
  // re-selecting by org — callers that just mutated one datasource pass it so the
  // rebuild targets the same doc.
  providedDatasource: DataSourceInterface | null = null,
): Promise<void> {
  const datasource =
    providedDatasource ??
    (await dangerouslyGetGrowthbookDatasourceBypassPermission(context));
  if (
    !datasource ||
    datasource.type !== "growthbook_clickhouse" ||
    !datasource.settings.useJsonColumns
  ) {
    return;
  }

  // Custom identifiers + dimensions preserved from a legacy migration. Threaded through
  // every builder so they survive attribute-schema regeneration: identifiers become
  // top-level join-key aliases, dimensions become top-level aliases under their legacy
  // names (so bare references keep resolving).
  const extraIdentifiers = datasource.settings.migratedIdentifiers || [];
  const migratedColumns = datasource.settings.migratedColumns || [];

  const newUserIdTypes = getManagedWarehouseUserIdTypes(
    attributeSchema,
    extraIdentifiers,
  );

  // Desired typed `attributes.<property>` ALIAS columns. Persisted on the
  // datasource doc as the source of truth the license server reads when it
  // (re)applies the DDL — at provision, recreate, or an explicit sync.
  const typedAttributeColumns = getManagedWarehouseTypedAttributeColumns(
    attributeSchema,
    extraIdentifiers,
  );

  // Update datasource settings (userIdTypes + exposure queries).
  // updateDataSource short-circuits when nothing actually changed.
  // Skip live exposure-query validation: this is a best-effort sync and the
  // queries are GrowthBook-authored, so an attribute change shouldn't block on
  // (or be flagged by) a slow/unreachable warehouse.
  await updateDataSource(
    context,
    datasource,
    {
      settings: {
        ...datasource.settings,
        userIdTypes: getManagedWarehouseUserIdTypeSettings(
          attributeSchema,
          extraIdentifiers,
        ),
        typedAttributeColumns,
        queries: {
          ...datasource.settings.queries,
          exposure: buildManagedWarehouseExposureQueries(
            attributeSchema,
            extraIdentifiers,
            migratedColumns,
          ),
        },
      },
    },
    { skipExposureQueryValidation: true },
  );

  // Update the events fact table sql + columns + userIdTypes
  const ft = await dangerouslyGetFactTableByIdBypassPermission(
    context.org.id,
    MANAGED_WAREHOUSE_EVENTS_FACT_TABLE_ID,
  );
  if (!ft) return;

  const desiredColumns = getManagedWarehouseEventsFactTableColumns(
    attributeSchema,
    extraIdentifiers,
    migratedColumns,
  );
  const desiredColumnNames = new Set(desiredColumns.map((c) => c.column));

  const newColumns: ColumnInterface[] = [...ft.columns];
  newColumns.forEach((col) => {
    if (col.numberFormat === undefined) {
      col.numberFormat = "";
    }
  });

  let columnsMutated = false;

  // Add new columns, restore any that were previously removed
  desiredColumns.forEach((dc) => {
    const existing = newColumns.find((c) => c.column === dc.column);
    if (!existing) {
      newColumns.push({
        column: dc.column,
        name: dc.column,
        datatype: dc.datatype,
        dateCreated: new Date(),
        dateUpdated: new Date(),
        deleted: false,
        description: "",
        numberFormat: "",
        alwaysInlineFilter: dc.alwaysInlineFilter,
      });
      columnsMutated = true;
    } else if (existing.deleted) {
      existing.deleted = false;
      existing.dateUpdated = new Date();
      columnsMutated = true;
    }
  });

  // Mark removed custom identifiers as deleted. Only ever delete former
  // identifier aliases, never real columns: a custom identifier is guaranteed
  // non-reserved (reserved-name collisions are excluded when building
  // identifiers), so skipping reserved columns protects every `SELECT *` column
  // the refresh job discovered (e.g. `url`, `session_id`) from being removed on
  // an unrelated attribute edit.
  newColumns.forEach((col) => {
    if (
      !col.deleted &&
      !desiredColumnNames.has(col.column) &&
      !MANAGED_WAREHOUSE_RESERVED_COLUMN_NAMES.has(col.column.toLowerCase())
    ) {
      col.deleted = true;
      col.dateUpdated = new Date();
      columnsMutated = true;
    }
  });

  // Keep the `attributes` JSON pseudo-columns in sync with the attribute schema:
  // schema-declared fields win (so a type change propagates), while any extra
  // fields discovered from data by the refresh job are preserved.
  const desiredJsonFields = desiredColumns.find(
    (c) => c.column === MANAGED_WAREHOUSE_ATTRIBUTES_COLUMN,
  )?.jsonFields;
  const attributesCol = newColumns.find(
    (c) => c.column === MANAGED_WAREHOUSE_ATTRIBUTES_COLUMN,
  );
  if (attributesCol && desiredJsonFields) {
    const mergedJsonFields = {
      ...attributesCol.jsonFields,
      ...desiredJsonFields,
    };
    if (!isEqual(attributesCol.jsonFields || {}, mergedJsonFields)) {
      attributesCol.jsonFields = mergedJsonFields;
      attributesCol.dateUpdated = new Date();
      columnsMutated = true;
    }
  }

  const newSql = buildManagedWarehouseEventsFactTableSql(
    attributeSchema,
    extraIdentifiers,
    migratedColumns,
  );

  // Skip the write when nothing changed (e.g. a tag/description-only edit on an
  // identifier attribute) to avoid needless fact-table churn.
  if (
    !columnsMutated &&
    ft.sql === newSql &&
    isEqual(ft.userIdTypes || [], newUserIdTypes)
  ) {
    return;
  }

  await dangerouslySyncManagedWarehouseFactTable(context, ft, {
    sql: newSql,
    columns: newColumns,
    userIdTypes: newUserIdTypes,
  });
}

/**
 * Ask the license server to (re)apply the JSON-ergonomics DDL — per-org user
 * settings + typed `attributes.<property>` ALIAS columns — from the
 * `typedAttributeColumns` persisted on the datasource doc. Idempotent and
 * metadata-only, so safe to call on every attribute change. Skips warehouses
 * with no physical JSON tables to alter (unprovisioned, legacy, or
 * mid-recreate); those get the columns at provision/recreate time instead.
 * Throws on failure — callers decide whether that's fatal (the backfill job)
 * or logged (attribute changes). Returns whether the DDL was actually applied.
 */
export async function applyManagedWarehouseJsonErgonomics(
  context: ReqContext | ApiReqContext,
): Promise<boolean> {
  const datasource =
    await dangerouslyGetGrowthbookDatasourceBypassPermission(context);
  if (
    !datasource ||
    datasource.type !== "growthbook_clickhouse" ||
    !datasource.settings.useJsonColumns ||
    isManagedWarehouseAwaitingProvisioning(datasource) ||
    isManagedWarehouseMigrating(datasource)
  ) {
    return false;
  }
  return syncJsonErgonomicsInClickhouse(datasource.organization);
}

// Best-effort wrapper for attribute create/update/delete (internal + REST API):
// a managed-warehouse sync failure must never fail the attribute change itself.
// Runs for any attribute change (not just identifiers) so the `attributes` JSON
// pseudo-columns track non-identifier attributes and their type changes too; the
// underlying sync no-ops when nothing material actually changed.
export async function syncManagedWarehouseIdentifiersOnAttributeChange(
  context: ReqContext | ApiReqContext,
  attributeSchema: SDKAttributeSchema | undefined,
): Promise<void> {
  try {
    await syncManagedWarehouseIdentifiers(context, attributeSchema);
    // Push the (possibly changed) typed attribute columns to ClickHouse. Also
    // best-effort: a stale column set degrades bare SQL for the new attribute,
    // and the next attribute change or table recreate re-syncs it.
    await applyManagedWarehouseJsonErgonomics(context);
  } catch (e) {
    logger.error(
      e,
      "Failed to sync managed warehouse identifiers after attribute change",
    );
  }
}

// Drop a preserved legacy identifier from a managed warehouse. The JSON migration
// keeps legacy join keys (identifiers present pre-migration but no longer in the
// attribute schema) in `migratedIdentifiers` so historical experiments don't break —
// but there was no way to remove one that's since gone dead (e.g. a renamed attribute).
// Only entries in `migratedIdentifiers` are removable; builtins and current
// hashAttribute identifiers are managed via the attribute schema, not here. The re-sync
// rebuilds userIdTypes / exposure queries and drops the identifier's fact-table column.
export async function removeManagedWarehouseLegacyIdentifier(
  context: ReqContext | ApiReqContext,
  datasource: DataSourceInterface,
  identifier: string,
): Promise<void> {
  if (datasource.type !== "growthbook_clickhouse") {
    throw new Error("Not a managed warehouse datasource");
  }

  const migrated = datasource.settings.migratedIdentifiers || [];
  if (!migrated.includes(identifier)) {
    throw new Error(
      `"${identifier}" is not a removable legacy identifier. Only preserved legacy identifiers can be removed; current identifiers are managed through your attributes.`,
    );
  }

  const updatedSettings = {
    ...datasource.settings,
    migratedIdentifiers: migrated.filter((t) => t !== identifier),
  };
  await updateDataSource(
    context,
    datasource,
    { settings: updatedSettings },
    { skipExposureQueryValidation: true },
  );

  // Reconcile the same datasource we just updated (with its post-removal settings),
  // rather than letting the sync re-select a warehouse by org.
  await syncManagedWarehouseIdentifiers(context, undefined, {
    ...datasource,
    settings: updatedSettings,
  });

  // Drop the identifier's typed ALIAS column in ClickHouse. Best-effort: the
  // Mongo state above is already correct, and a lingering column is harmless
  // until the next attribute change or recreate re-syncs it.
  await applyManagedWarehouseJsonErgonomics(context).catch((e) =>
    logger.error(
      e,
      "Failed to sync typed attribute columns after removing legacy identifier",
    ),
  );
}
