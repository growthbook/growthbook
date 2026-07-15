import { MANAGED_WAREHOUSE_EVENTS_FACT_TABLE_ID } from "shared/constants";
import {
  buildManagedWarehouseEventsFactTableSql,
  buildManagedWarehouseExposureQueries,
  getManagedWarehouseCustomIdentifiers,
  getManagedWarehouseEventsFactTableColumns,
  getManagedWarehouseUserIdTypes,
  getManagedWarehouseUserIdTypeSettings,
  isManagedWarehouseAwaitingJsonMigration,
  isManagedWarehouseAwaitingProvisioning,
  isManagedWarehouseMigrating,
  MANAGED_WAREHOUSE_ATTRIBUTES_COLUMN,
  MANAGED_WAREHOUSE_BUILTIN_IDENTIFIERS,
  MANAGED_WAREHOUSE_RESERVED_COLUMN_NAMES,
} from "shared/util";
import { DataSourceInterface } from "shared/types/datasource";
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
  clearManagedWarehouseRecreateStatus,
  getManagedWarehouseRecreateState,
  updateDataSource,
} from "back-end/src/models/DataSourceModel";
import { dangerousRecreateClickhouseTables } from "back-end/src/services/licenseServerManagedClickhouse";
import { getMigratedDimensionColumns } from "back-end/src/util/migrateManagedWarehouseColumns";
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
}

// Kick off the async table rebuild. The license server acks and rebuilds in the
// background, so this doesn't wait for the tables — a later run finalizes once the
// rebuild's lock frees (see migrateManagedWarehouseToJson).
async function fireManagedWarehouseRecreate(
  organization: string,
): Promise<void> {
  const result = await dangerousRecreateClickhouseTables(organization);
  if (result === "already-running") {
    // The lock was taken between our read and this call; the in-progress rebuild
    // will record its own outcome, so just wait for it.
    logger.info(
      `Managed warehouse migration for org ${organization}: recreate already in progress; waiting`,
    );
  }
}

// Migrate a legacy (materialized-column) managed warehouse to native JSON columns.
// Recreate now acks and rebuilds the per-org tables in the background under a
// datasource lock (holding the connection open for the whole rebuild 504'd behind the
// proxy), so this is idempotent + resumable and re-driven by the sweep / next query
// until it settles: it prepares metadata and fires the rebuild, then finalizes on
// success or retries on failure once the lock frees — reading `lockUntil` (rebuild in
// progress) and `recreateStatus` (its outcome) via getManagedWarehouseRecreateState.
// A crash at any step leaves a re-runnable state, and `migrating` blocks queries
// throughout so nothing hits the tables mid-rebuild.
export async function migrateManagedWarehouseToJson(
  context: ReqContext | ApiReqContext,
): Promise<void> {
  const datasource =
    await dangerouslyGetGrowthbookDatasourceBypassPermission(context);
  if (!datasource || datasource.type !== "growthbook_clickhouse") {
    return;
  }

  // Defer until provisioned: recreating tables for a never-provisioned org would
  // race the normal provisioning flow (and spam Sentry).
  if (isManagedWarehouseAwaitingProvisioning(datasource)) {
    return;
  }

  const migrating = isManagedWarehouseMigrating(datasource);
  const awaiting = isManagedWarehouseAwaitingJsonMigration(datasource);
  // Fully migrated and settled — nothing to do.
  if (!migrating && !awaiting) {
    return;
  }

  const { locked, recreateStatus } =
    await getManagedWarehouseRecreateState(context);

  // A rebuild is running on the license server (ours or another operation's). It
  // holds the lock for its duration, so wait rather than re-request — the sweep /
  // next query re-drives this once the lock frees.
  if (locked) {
    return;
  }

  // We already prepared the migration (materializedColumns cleared) and the rebuild
  // we fired is no longer running — settle based on its recorded outcome.
  if (migrating && !awaiting) {
    if (recreateStatus === "success") {
      // Tables were rebuilt as JSON and the fact table was synced before we fired the
      // rebuild, so unblocking queries now is safe.
      await updateDataSource(
        context,
        datasource,
        { settings: { ...datasource.settings, migrating: false } },
        { skipExposureQueryValidation: true },
      );
      return;
    }
    // "error", or missing (rebuild crashed before recording its outcome, or we
    // crashed before firing it): retry. The rebuild is idempotent and matcols stay
    // cleared (JSON tables ignore them), so re-firing rebuilds the JSON tables cleanly.
    await fireManagedWarehouseRecreate(datasource.organization);
    return;
  }

  // awaiting === true: (re)start the migration.
  const matColumns = datasource.settings.materializedColumns || [];
  const attributeSchema = context.org.settings?.attributeSchema;

  // Preserve every legacy custom identifier (a `userIdType` that isn't a built-in or a
  // current hashAttribute) by carrying it as an `attributes`-aliased top-level column,
  // exactly like a hashAttribute identifier. This keeps the join keys experiments/metrics
  // depend on, so the migration never has to skip a warehouse over identifier drift.
  // Persisted in `migratedIdentifiers` so the attribute-change sync re-includes them.
  const builtins = new Set<string>(MANAGED_WAREHOUSE_BUILTIN_IDENTIFIERS);
  const schemaIdentifiers = new Set(
    getManagedWarehouseCustomIdentifiers(attributeSchema),
  );
  const migratedIdentifiers = (datasource.settings.userIdTypes || [])
    .map((u) => u.userIdType)
    .filter((t) => !builtins.has(t) && !schemaIdentifiers.has(t));

  // Non-identifier dimensions to preserve as top-level aliases (so bare references in
  // raw-SQL filters, exposure breakdowns, and fact-table-routed metrics keep resolving).
  const migratedColumns = getMigratedDimensionColumns(
    matColumns,
    MANAGED_WAREHOUSE_RESERVED_COLUMN_NAMES,
  );

  // Enter the transient "migrating" state (still provisioned) so in-flight usage
  // degrades to "warehouse upgrading" instead of hitting tables mid-rebuild, and flip
  // the flag (the license server reads `useJsonColumns` to pick the JSON DDL). Record the
  // preserved identifiers + dimensions up front so the sync (below) aliases them. Keep
  // `materializedColumns` for now so a crash before we clear them re-runs this branch.
  await updateDataSource(
    context,
    datasource,
    {
      settings: {
        ...datasource.settings,
        useJsonColumns: true,
        migrating: true,
        migratedIdentifiers,
        migratedColumns,
      },
    },
    // Never run live exposure-query validation here: the warehouse is about to be
    // recreated, so a validation query would fail or hang against it.
    { skipExposureQueryValidation: true },
  );

  // Regenerate the ch_events fact table + datasource userIdTypes/exposure queries.
  // Mongo-only (queries stay blocked by `migrating`), and re-exposes the preserved
  // identifiers/dimensions as top-level aliases so existing metric refs keep resolving —
  // no metric rewrite needed. Must finish before we fire the rebuild, so that when a
  // later run unblocks queries on success, the fact table already matches the tables.
  await syncManagedWarehouseIdentifiers(context);

  // Clear materializedColumns (re-fetch: sync mutated the datasource settings). Only once
  // this is persisted is the warehouse structurally migrated; the rebuild we fire next
  // produces the physical JSON tables.
  const synced =
    await dangerouslyGetGrowthbookDatasourceBypassPermission(context);
  if (!synced || synced.type !== "growthbook_clickhouse") {
    // Couldn't re-fetch to clear materializedColumns: it stays awaiting-migration and
    // re-runs this branch on next use. Log so the (rare) re-trigger loop is visible.
    logger.error(
      `Managed warehouse migration for org ${datasource.organization}: could not re-fetch datasource after sync; migration will re-trigger on next use`,
    );
    return;
  }
  // Forget any prior rebuild outcome BEFORE clearing materializedColumns, so once the
  // warehouse is structurally migrated (matcols cleared) the settle branch can't read a
  // stale `recreateStatus="success"` from an earlier recreate and unblock over the wrong
  // tables. The rebuild we fire below records this migration's fresh outcome.
  await clearManagedWarehouseRecreateStatus(context);
  await updateDataSource(
    context,
    synced,
    { settings: { ...synced.settings, materializedColumns: undefined } },
    { skipExposureQueryValidation: true },
  );

  // Fire the async rebuild last: the license server acks and rebuilds in the background,
  // recording the outcome. A later run finalizes (unblocks) once the lock frees.
  await fireManagedWarehouseRecreate(datasource.organization);
}
