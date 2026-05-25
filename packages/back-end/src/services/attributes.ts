import { SDKAttribute } from "shared/types/organization";
import { MANAGED_WAREHOUSE_EVENTS_FACT_TABLE_ID } from "shared/constants";
import type { MaterializedColumn } from "shared/types/datasource";
import {
  buildManagedWarehouseFactTableSQL,
  categorizeUnregisteredAttributes,
  extractConditionAttributeKeys,
  getRequireRegisteredAttributesSettings,
  isManagedWarehouseAwaitingProvisioning,
} from "shared/util";
import type { ColumnInterface } from "shared/types/fact-table";
import { dangerouslyGetGrowthbookDatasourceBypassPermission } from "back-end/src/models/DataSourceModel";
import {
  dangerouslyGetFactTableByIdBypassPermission,
  updateFactTableColumns,
} from "back-end/src/models/FactTableModel";
import { updateOrganization } from "back-end/src/models/OrganizationModel";
import {
  prepareManagedWarehouseAttributeMigrationViaLicenseServer,
  syncManagedWarehouseAttributesViaLicenseServer,
} from "back-end/src/services/licenseServerManagedClickhouse";
import { logger } from "back-end/src/util/logger";
import { BadRequestError } from "back-end/src/util/errors";
import { ReqContext } from "back-end/types/request";

export async function removeTagInAttribute(
  context: ReqContext,
  tag: string,
): Promise<void> {
  const { org } = context;
  const attributeSchema = org.settings?.attributeSchema || [];

  const hasTag = attributeSchema.some((a) => (a.tags || []).includes(tag));
  if (!hasTag) return;

  const updatedAttributeSchema = attributeSchema.map((attr) => ({
    ...attr,
    tags: (attr.tags || []).filter((t) => t !== tag),
  }));

  // Tag changes don't affect materialized columns, so skip the license-server
  // sync. Going through `updateAttributeSchema` would couple a metadata-only
  // operation to warehouse availability — a 423 lock or LS outage would cause
  // the tag removal to roll back.
  await updateOrganization(org.id, {
    settings: { ...org.settings, attributeSchema: updatedAttributeSchema },
  });
}

/**
 * Persist a new attributeSchema on the organization and keep any Managed
 * Warehouse datasource in sync (ClickHouse DDL + derived userIdTypes +
 * exposure queries) via the license server.
 *
 * The flow is two-phase to avoid stranding migration backfill outside of
 * the org if the sync fails partway through:
 *   1. Ask LS for any first-time-migration `attributeBackfill` (read-only).
 *   2. Merge backfill into the org write — so `attributeSchema` always
 *      reflects every column LS will end up materializing.
 *   3. Call sync (DDL + snapshot write). On failure roll the org back to
 *      its post-migration / pre-edit state; the migration is preserved so
 *      retries don't replay it.
 */
export async function updateAttributeSchema(
  context: ReqContext,
  {
    newAttributeSchema,
    renames = [],
    skipManagedWarehouseNameValidation = false,
  }: {
    newAttributeSchema: SDKAttribute[];
    renames?: { from: string; to: string }[];
    /**
     * Bypass the Managed Warehouse column-name validation. Intended for
     * system-triggered paths (e.g. `$groups` auto-add) where we accept that
     * the attribute won't materialize — the license server silently skips
     * invalid names during column derivation.
     */
    skipManagedWarehouseNameValidation?: boolean;
  },
): Promise<{ persistedAttributeSchema: SDKAttribute[] }> {
  const { org } = context;
  // Bypass the read-permission gate here. An admin who can manage attributes
  // but lacks read on the warehouse datasource project would otherwise silently
  // skip the LS sync and leave ClickHouse out of step with attributeSchema.
  const managedWarehouse =
    await dangerouslyGetGrowthbookDatasourceBypassPermission(org.id);

  // No managed warehouse: nothing to back-fill against; just persist.
  if (!managedWarehouse) {
    await updateOrganization(org.id, {
      settings: { ...org.settings, attributeSchema: newAttributeSchema },
    });
    return { persistedAttributeSchema: newAttributeSchema };
  }

  const currentAttributeSchema = org.settings?.attributeSchema || [];

  // Phase 1: ask LS what first-time-migration backfill (if any) we need to
  // merge into the org write. Skipped on the steady-state path: once a sync
  // has run, `syncedMaterializedColumns` is populated and prepare would
  // unconditionally return an empty backfill — saves a round-trip per edit.
  //
  // Done before the pre-provisioning branch below so that orgs editing
  // attributes during the awaiting-provisioning window still get the legacy
  // `materializedColumns` migrated into `attributeSchema`. Otherwise the
  // provisioning job would seed CH from a backfill-less schema and drop the
  // org's pre-existing key attributes.
  let attributeBackfill: SDKAttribute[] = [];
  if (managedWarehouse.settings.syncedMaterializedColumns === undefined) {
    const prepared =
      await prepareManagedWarehouseAttributeMigrationViaLicenseServer({
        orgId: org.id,
        currentAttributeSchema,
      });
    attributeBackfill = prepared.attributeBackfill;
  }

  const mergeWithBackfill = (schema: SDKAttribute[]): SDKAttribute[] => {
    if (attributeBackfill.length === 0) return schema;
    const present = new Set(schema.map((a) => a.property));
    return [
      ...schema,
      ...attributeBackfill.filter((a) => !present.has(a.property)),
    ];
  };
  const finalAttributeSchema = mergeWithBackfill(newAttributeSchema);
  // Rollback target: the post-migration but pre-edit state. Backfill stays
  // applied across rollback so retries don't replay migration.
  const postMigrationCurrentSchema = mergeWithBackfill(currentAttributeSchema);

  // Skip the LS sync when ClickHouse isn't ready yet. The async provisioning
  // job picks up the saved (now-backfilled) attributeSchema once it runs.
  if (isManagedWarehouseAwaitingProvisioning(managedWarehouse)) {
    await updateOrganization(org.id, {
      settings: { ...org.settings, attributeSchema: finalAttributeSchema },
    });
    return { persistedAttributeSchema: finalAttributeSchema };
  }

  // Phase 2: persist the org write before calling sync. If sync fails after
  // applying DDL, the rollback below restores the post-migration / pre-edit
  // state; the snapshot is whatever LS managed to write, and the next sync
  // diffs the user's retry against that ground truth.
  await updateOrganization(org.id, {
    settings: { ...org.settings, attributeSchema: finalAttributeSchema },
  });

  // Capture the pre-sync materialized-column state so we can update the
  // events fact table after LS reports the new state. Falls back to legacy
  // `materializedColumns` on first-time migration (LS uses the same
  // fallback when computing its diff).
  const previousMaterializedColumns =
    managedWarehouse.settings.syncedMaterializedColumns ??
    managedWarehouse.settings.materializedColumns ??
    [];

  let syncResult;
  try {
    syncResult = await syncManagedWarehouseAttributesViaLicenseServer({
      orgId: org.id,
      attributeSchema: finalAttributeSchema,
      previousAttributeSchema: postMigrationCurrentSchema,
      renames,
      skipNameValidation: skipManagedWarehouseNameValidation,
    });
  } catch (e) {
    logger.error(
      {
        err: e,
        orgId: org.id,
        datasourceId: managedWarehouse.id,
        attemptedAttributeProperties: finalAttributeSchema.map(
          (a) => a.property,
        ),
        rolledBackToAttributeProperties: postMigrationCurrentSchema.map(
          (a) => a.property,
        ),
        renames,
      },
      "Managed Warehouse sync failed; rolling back attributeSchema",
    );
    await rollbackAttributeSchema(context, postMigrationCurrentSchema);
    // Preserve `ManagedClickhouseClientError` so the API layer can use its
    // `status` (e.g. 404, 400) instead of falling back to a generic 400.
    throw e;
  }

  // The datasource snapshot itself (`syncedMaterializedColumns`,
  // `userIdTypes`, `queries.exposure`, and the first-migration `$unset` of
  // legacy `materializedColumns`) has already been persisted by the license
  // server inside the sync call — LS's DataSourceModel writes via
  // `useDb(GROWTHBOOK_DB_NAME)` directly into this same `datasources`
  // collection, under the per-org lock LS holds for the duration of sync.
  // We deliberately do NOT re-apply `syncResult` here: a follow-up write
  // from GB would land outside that lock and could race a subsequent sync.
  // `syncResult` is consumed below only as input to the fact-table
  // reconciliation, which is a GB-owned concern.

  // CH and the org are in sync. Reconcile the events fact table's columns
  // so metric/dimension pickers reflect the new materialized-column set.
  // This is best-effort: a stale fact table is recoverable by manual
  // refresh, so we don't fail the request or roll the org back if it
  // doesn't go through.
  try {
    await syncManagedWarehouseEventsFactTable(context, {
      previousColumns: previousMaterializedColumns,
      finalColumns: syncResult.syncedMaterializedColumns,
      renames,
    });
  } catch (e) {
    logger.error(
      { err: e, orgId: org.id, datasourceId: managedWarehouse.id },
      "Failed to sync managed warehouse events fact table after attribute change",
    );
  }

  return { persistedAttributeSchema: finalAttributeSchema };
}

type MaterializedColumnDiff = {
  columnsToAdd: MaterializedColumn[];
  columnsToDelete: string[];
  columnsToRename: { from: string; to: string }[];
};

/**
 * Reconciles previous vs final materialized columns into the add/delete/rename
 * plan needed to update the events fact table. Mirrors the rename semantics
 * the license server uses on the DDL side: a rename only "applies" when the
 * source column exists in `previous`, the destination exists in `final`, and
 * the destination isn't already a different existing column. Other renames
 * fall through to natural add/delete.
 */
export function diffMaterializedColumnsForFactTable(
  previous: MaterializedColumn[],
  final: MaterializedColumn[],
  renames: { from: string; to: string }[],
): MaterializedColumnDiff {
  const previousByName = new Map(previous.map((c) => [c.columnName, c]));
  const finalByName = new Map(final.map((c) => [c.columnName, c]));

  const appliedRenames: { from: string; to: string }[] = [];
  for (const { from, to } of renames) {
    if (from === to) continue;
    const prev = previousByName.get(from);
    if (!prev || !finalByName.has(to)) continue;
    if (previousByName.has(to)) continue;
    previousByName.delete(from);
    previousByName.set(to, { ...prev, columnName: to, sourceField: to });
    appliedRenames.push({ from, to });
  }

  const columnsToAdd: MaterializedColumn[] = [];
  for (const [name, col] of finalByName) {
    if (!previousByName.has(name)) columnsToAdd.push(col);
  }

  const columnsToDelete: string[] = [];
  for (const name of previousByName.keys()) {
    if (!finalByName.has(name)) columnsToDelete.push(name);
  }

  return { columnsToAdd, columnsToDelete, columnsToRename: appliedRenames };
}

/**
 * Update the managed warehouse's events fact table so its columns mirror the
 * post-sync materialized-column set. Adds new columns, soft-deletes removed
 * ones (preserving any metrics that reference them), and renames in place
 * where possible. Resets `userIdTypes` to the identifiers in `finalColumns`,
 * intersected with active (non-deleted) columns by
 * `updateFactTableColumns`.
 */
async function syncManagedWarehouseEventsFactTable(
  context: ReqContext,
  {
    previousColumns,
    finalColumns,
    renames,
  }: {
    previousColumns: MaterializedColumn[];
    finalColumns: MaterializedColumn[];
    renames: { from: string; to: string }[];
  },
): Promise<void> {
  // Bypass project-read permission here for the same reason the datasource
  // lookup does: an attribute admin who lacks read on the warehouse fact
  // table's project would otherwise silently skip this reconciliation and
  // leave the fact table out of step with materialized columns.
  const ft = await dangerouslyGetFactTableByIdBypassPermission(
    context.org.id,
    MANAGED_WAREHOUSE_EVENTS_FACT_TABLE_ID,
  );
  if (!ft) return;

  const { columnsToAdd, columnsToDelete, columnsToRename } =
    diffMaterializedColumnsForFactTable(previousColumns, finalColumns, renames);

  // The generated SQL changes whenever the materialized-column set or its
  // physical names change — adds/deletes/renames all flip the projection
  // list, and the prefix rollout flips physical names for unchanged logical
  // ones. Compute the new SQL up front so the no-op short-circuit below can
  // also short-circuit on identical SQL.
  const newSql = buildManagedWarehouseFactTableSQL(finalColumns);
  const sqlChanged = newSql !== ft.sql;

  // Identifier set can change even when columns and SQL don't — e.g. toggling
  // `hashAttribute` on an existing attribute, or an SDK-alias edit that
  // promotes a built-in to identifier. Compute and compare so we still
  // reconcile `userIdTypes` in those cases.
  const newIdentifierTypes = finalColumns
    .filter((c) => c.type === "identifier")
    .map((c) => c.columnName);
  const userIdTypesChanged =
    newIdentifierTypes.length !== (ft.userIdTypes?.length ?? 0) ||
    newIdentifierTypes.some((t) => !(ft.userIdTypes ?? []).includes(t));

  if (
    columnsToAdd.length === 0 &&
    columnsToDelete.length === 0 &&
    columnsToRename.length === 0 &&
    !sqlChanged &&
    !userIdTypesChanged
  ) {
    return;
  }

  const newColumns: ColumnInterface[] = ft.columns.map((col) => ({
    ...col,
    numberFormat: col.numberFormat ?? "",
  }));

  for (const col of columnsToAdd) {
    const existing = newColumns.find((c) => c.column === col.columnName);
    if (!existing) {
      newColumns.push({
        column: col.columnName,
        name: col.columnName,
        // FactTableColumnType has no array variant — `other` is the closest
        // fit for `string[]` / `number[]` materialized columns so the picker
        // doesn't mis-classify them as plain strings.
        datatype: col.arrayElementType ? "other" : col.datatype,
        dateCreated: new Date(),
        dateUpdated: new Date(),
        deleted: false,
        description: "",
        numberFormat: "",
      });
    } else {
      // Column was previously soft-deleted; restore it.
      existing.deleted = false;
      existing.dateUpdated = new Date();
    }
  }

  for (const { from, to } of columnsToRename) {
    const col = newColumns.find((c) => c.column === from);
    if (!col) continue;
    const existingDest = newColumns.find((c) => c.column === to);
    if (existingDest) {
      // Destination already exists — restore it and mark the source deleted
      // so any metrics still pointing at `from` fail-closed instead of
      // silently merging.
      existingDest.deleted = false;
      existingDest.dateUpdated = new Date();
      col.deleted = true;
      col.dateUpdated = new Date();
    } else {
      col.column = to;
      col.name = to;
      col.dateUpdated = new Date();
    }
  }

  for (const name of columnsToDelete) {
    const col = newColumns.find((c) => c.column === name);
    if (col) {
      col.deleted = true;
      col.dateUpdated = new Date();
    }
  }

  await updateFactTableColumns(
    ft,
    {
      columns: newColumns,
      userIdTypes: newIdentifierTypes,
      sql: newSql,
    },
    context,
  );
}

/**
 * Restore the org's attributeSchema after a failed Managed Warehouse sync,
 * landing on the post-migration / pre-edit state so the migration backfill
 * (if any) is preserved across retries.
 */
async function rollbackAttributeSchema(
  context: ReqContext,
  postMigrationCurrentSchema: SDKAttribute[],
): Promise<void> {
  try {
    await updateOrganization(context.org.id, {
      settings: {
        ...context.org.settings,
        attributeSchema: postMigrationCurrentSchema,
      },
    });
  } catch (rollbackError) {
    logger.error(
      rollbackError,
      "Failed to roll back attributeSchema after Managed Warehouse sync failure",
    );
  }
}

// Rejects saves that reference attribute keys not declared (and not archived)
// in the org's attributeSchema. No-op unless the org opts in via
// `settings.requireRegisteredAttributes`. Mirrors the existing saved-group
// "Unknown attributeKey" behavior so feature rules and experiments can't
// silently ship dead targeting due to typos like account_uuid vs accountUUID.
//
// `condition` must be a raw JSON string — this helper does not validate JSON
// shape (that's `validateCondition`'s job); it only scans field names after
// parsing and silently returns if parsing fails.
type AttributeParts = {
  hashAttribute?: string | null;
  fallbackAttribute?: string | null;
  condition?: string | null;
};

// When `existingParts` is provided, only validates fields that actually
// changed — so pre-existing violations don't block unrelated edits.
// When `project` is provided, attributes scoped to other projects are
// treated as unregistered (matches the frontend dropdown filtering).
export function assertRegisteredAttributes(
  context: ReqContext,
  parts: AttributeParts,
  label: string,
  existingParts?: AttributeParts,
  project?: string | string[],
): void {
  const { isOn, requireProjectScoping } =
    getRequireRegisteredAttributesSettings(
      context.org.settings?.requireRegisteredAttributes,
    );
  if (!isOn) return;

  const attributeSchema = context.org.settings?.attributeSchema || [];
  const keys: string[] = [];

  const changed = (field: keyof AttributeParts): boolean =>
    !!parts[field] && (!existingParts || parts[field] !== existingParts[field]);

  if (changed("hashAttribute")) keys.push(parts.hashAttribute!);
  if (changed("fallbackAttribute")) keys.push(parts.fallbackAttribute!);

  if (changed("condition") && parts.condition !== "{}") {
    try {
      const parsed = JSON.parse(parts.condition!);
      keys.push(...extractConditionAttributeKeys(parsed));
    } catch {
      // Unparseable condition — `validateCondition` elsewhere will surface
      // the JSON error. Don't double-throw here.
    }
  }

  if (!keys.length) return;

  // Pass `project` to the categorizer only when the org has opted into the
  // stricter project-scope check; otherwise out-of-project attributes are
  // bucketed as "registered" and pass.
  const { unknown, outOfProject } = categorizeUnregisteredAttributes(
    keys,
    attributeSchema,
    requireProjectScoping ? project : undefined,
  );
  if (!unknown.length && !outOfProject.length) return;

  throw new BadRequestError(
    formatUnregisteredAttributesError(label, { unknown, outOfProject }),
  );
}

// Shared formatter so the message is identical between assertRegisteredAttributes
// and the front-end pre-flight (`validateUnregisteredAttributes` mirrors this).
export function formatUnregisteredAttributesError(
  label: string,
  buckets: { unknown: string[]; outOfProject: string[] },
): string {
  const parts: string[] = [];
  if (buckets.unknown.length) {
    const quoted = buckets.unknown.map((k) => `"${k}"`).join(", ");
    parts.push(`Unknown attribute key(s) on ${label}: ${quoted}.`);
  }
  if (buckets.outOfProject.length) {
    const quoted = buckets.outOfProject.map((k) => `"${k}"`).join(", ");
    parts.push(
      `Attribute key(s) are not part of this project's scope: ${quoted}.`,
    );
  }
  return parts.join("\n");
}
