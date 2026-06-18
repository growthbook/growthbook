import { MANAGED_WAREHOUSE_EVENTS_FACT_TABLE_ID } from "shared/constants";
import {
  buildManagedWarehouseEventsFactTableSql,
  buildManagedWarehouseExposureQueries,
  getManagedWarehouseEventsFactTableColumns,
  getManagedWarehouseUserIdTypes,
  getManagedWarehouseUserIdTypeSettings,
  isManagedWarehouseAwaitingProvisioning,
  MANAGED_WAREHOUSE_ATTRIBUTES_COLUMN,
  MANAGED_WAREHOUSE_RESERVED_COLUMN_NAMES,
} from "shared/util";
import {
  GrowthbookClickhouseDataSource,
  MaterializedColumn,
} from "shared/types/datasource";
import { SDKAttributeSchema } from "shared/types/organization";
import { ColumnInterface } from "shared/types/fact-table";
import { isEqual } from "lodash";
import type { ReqContext } from "back-end/types/request";
import type { ApiReqContext } from "back-end/types/api";
import {
  dangerouslyGetFactTableByIdBypassPermission,
  dangerouslySyncManagedWarehouseFactTable,
  getFactTablesForDatasource,
  updateFactTableColumns,
} from "back-end/src/models/FactTableModel";
import {
  dangerouslyGetGrowthbookDatasourceBypassPermission,
  updateDataSource,
} from "back-end/src/models/DataSourceModel";
import { updateMaterializedColumnsInClickhouse } from "back-end/src/services/licenseServerManagedClickhouse";
import { logger } from "back-end/src/util/logger";

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

// Re-sync a JSON-column managed warehouse after the org's identifiers change:
// regenerates the datasource userIdTypes/exposure queries and the `ch_events` fact
// table so custom identifiers are aliased out of `attributes`. No-op for legacy
// (materialized-column) warehouses or when no managed warehouse exists.
export async function syncManagedWarehouseIdentifiers(
  context: ReqContext | ApiReqContext,
  // Pass the freshly-updated schema; context.org may still be stale post-mutation.
  attributeSchema: SDKAttributeSchema | undefined = context.org.settings
    ?.attributeSchema,
): Promise<void> {
  const datasource =
    await dangerouslyGetGrowthbookDatasourceBypassPermission(context);
  if (
    !datasource ||
    datasource.type !== "growthbook_clickhouse" ||
    !datasource.settings.useJsonColumns
  ) {
    return;
  }

  const newUserIdTypes = getManagedWarehouseUserIdTypes(attributeSchema);

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
        userIdTypes: getManagedWarehouseUserIdTypeSettings(attributeSchema),
        queries: {
          ...datasource.settings.queries,
          exposure: buildManagedWarehouseExposureQueries(attributeSchema),
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

  const desiredColumns =
    getManagedWarehouseEventsFactTableColumns(attributeSchema);
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

  const newSql = buildManagedWarehouseEventsFactTableSql(attributeSchema);

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
