import { SDKAttribute } from "shared/types/organization";
import { MANAGED_WAREHOUSE_EVENTS_FACT_TABLE_ID } from "shared/constants";
import type {
  GrowthbookClickhouseDataSource,
  MaterializedColumn,
} from "shared/types/datasource";
import type { ColumnInterface } from "shared/types/fact-table";
import { dangerouslyGetGrowthbookDatasourceBypassPermission } from "back-end/src/models/DataSourceModel";
import {
  getFactTablesForDatasource,
  updateFactTableColumns,
} from "back-end/src/models/FactTableModel";
import { updateOrganization } from "back-end/src/models/OrganizationModel";
import {
  prepareManagedWarehouseAttributeMigrationViaLicenseServer,
  syncManagedWarehouseAttributesViaLicenseServer,
} from "back-end/src/services/licenseServerManagedClickhouse";
import { logger } from "back-end/src/util/logger";
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

  await updateAttributeSchema(context, {
    newAttributeSchema: updatedAttributeSchema,
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
): Promise<void> {
  const { org } = context;
  // Bypass the read-permission gate here. An admin who can manage attributes
  // but lacks read on the warehouse datasource project would otherwise silently
  // skip the LS sync and leave ClickHouse out of step with attributeSchema.
  const managedWarehouse =
    await dangerouslyGetGrowthbookDatasourceBypassPermission(org.id);

  if (!managedWarehouse) {
    await updateOrganization(org.id, {
      settings: { ...org.settings, attributeSchema: newAttributeSchema },
    });
    return;
  }

  const currentAttributeSchema = org.settings?.attributeSchema || [];

  // Phase 1: ask LS what first-time-migration backfill (if any) we need to
  // merge into the org write. Skipped on the steady-state path: once a sync
  // has run, `syncedMaterializedColumns` is populated and prepare would
  // unconditionally return an empty backfill — saves a round-trip per edit.
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

  // CH and the org are in sync. Reconcile the events fact table's columns
  // so metric/dimension pickers reflect the new materialized-column set.
  // This is best-effort: a stale fact table is recoverable by manual
  // refresh, so we don't fail the request or roll the org back if it
  // doesn't go through.
  try {
    await syncManagedWarehouseEventsFactTable(context, managedWarehouse, {
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
function diffMaterializedColumnsForFactTable(
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
  datasource: GrowthbookClickhouseDataSource,
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
  const factTables = await getFactTablesForDatasource(context, datasource.id);
  const ft = factTables.find(
    (f) => f.id === MANAGED_WAREHOUSE_EVENTS_FACT_TABLE_ID,
  );
  if (!ft) return;

  const { columnsToAdd, columnsToDelete, columnsToRename } =
    diffMaterializedColumnsForFactTable(previousColumns, finalColumns, renames);

  if (
    columnsToAdd.length === 0 &&
    columnsToDelete.length === 0 &&
    columnsToRename.length === 0
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

  const newIdentifierTypes = finalColumns
    .filter((c) => c.type === "identifier")
    .map((c) => c.columnName);

  await updateFactTableColumns(
    ft,
    { columns: newColumns, userIdTypes: newIdentifierTypes },
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
