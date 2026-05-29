import type {
  DataSourceInterface,
  MaterializedColumn,
} from "shared/types/datasource";

/** Docs: Managed Warehouse — sending events */
export const MANAGED_WAREHOUSE_SENDING_EVENTS_DOC_URL =
  "https://docs.growthbook.io/app/managed-warehouse#sending-events";

export const MANAGED_WAREHOUSE_NO_EVENTS_MESSAGE =
  "No events have been sent to your data warehouse yet.";

/** Returned in API `error` fields so the front-end can show the managed-warehouse docs callout. */
export const MANAGED_WAREHOUSE_PENDING_ERROR_CODE =
  "managed_warehouse_pending" as const;

export class ManagedWarehousePendingError extends Error {
  readonly code: typeof MANAGED_WAREHOUSE_PENDING_ERROR_CODE =
    MANAGED_WAREHOUSE_PENDING_ERROR_CODE;

  constructor() {
    super(MANAGED_WAREHOUSE_PENDING_ERROR_CODE);
    this.name = "ManagedWarehousePendingError";
    Object.setPrototypeOf(this, ManagedWarehousePendingError.prototype);
  }
}

export function isManagedWarehousePendingQueryError(
  message: string | null | undefined,
): boolean {
  if (message == null || message === "") return false;
  return message.includes(MANAGED_WAREHOUSE_PENDING_ERROR_CODE);
}

/**
 * Information schema and other APIs may persist a legacy long message, the
 * stable pending code, or the no-events sentence alone — use this to show the
 * managed-warehouse docs callout instead of raw error text.
 */
export function isManagedWarehouseNoEventsGuidanceMessage(
  message: string | null | undefined,
): boolean {
  if (message == null || message === "") return false;
  if (isManagedWarehousePendingQueryError(message)) return true;
  if (message.includes(MANAGED_WAREHOUSE_NO_EVENTS_MESSAGE)) return true;
  return message.includes(MANAGED_WAREHOUSE_SENDING_EVENTS_DOC_URL);
}

/** Normalize thrown errors for JSON `error` fields on query responses. */
export function formatQueryExecutionErrorForApi(e: unknown): string {
  if (e instanceof ManagedWarehousePendingError) {
    return MANAGED_WAREHOUSE_PENDING_ERROR_CODE;
  }
  if (
    e instanceof Error &&
    e.message === MANAGED_WAREHOUSE_PENDING_ERROR_CODE
  ) {
    return MANAGED_WAREHOUSE_PENDING_ERROR_CODE;
  }
  return e instanceof Error ? e.message : String(e);
}

/**
 * Managed Warehouse rows created before provisioning was deferred will not
 * have this flag; treat them as provisioned.
 */
export function isManagedWarehouseAwaitingProvisioning(
  datasource: Pick<DataSourceInterface, "type" | "settings">,
): boolean {
  if (datasource.type !== "growthbook_clickhouse") {
    return false;
  }
  const settings = datasource.settings as {
    hasBeenProvisioned?: boolean;
  };
  return settings?.hasBeenProvisioned === false;
}

const MANAGED_WAREHOUSE_FACT_TABLE_BASE_COLUMNS = [
  "timestamp",
  "client_key",
  "event_name",
  "properties",
  "attributes",
  "environment",
  "sdk_language",
  "sdk_version",
  "event_uuid",
  "ip",
] as const;

/**
 * Build the SELECT clause for the Managed Warehouse events fact table given
 * its current materialized columns. Built-in columns (where `columnName`
 * matches the CH-side physical name) are projected as-is; user-attribute
 * columns are aliased from their `matcol__` physical name back to the
 * logical `columnName` so anything written against the fact table can keep
 * using the unprefixed attribute name even as future built-ins land.
 *
 * Projections are emitted in a deterministic alphabetical order (by logical
 * columnName) so the same materialized-column set always produces the same
 * SQL — keeps audit log / commit-diff noise low across syncs.
 *
 * Safety: physical and logical names are interpolated directly into SQL
 * without quoting. Names are validated against
 * `validateManagedWarehouseColumnName` at attribute creation / sync time
 * (matches `/^[a-zA-Z_][a-zA-Z0-9_]*$/`), so nothing requiring escaping can
 * land in a materialized column. Lowercase `as` matches the LS-side DDL
 * generator for consistency.
 */
export function buildManagedWarehouseFactTableSQL(
  materializedColumns: MaterializedColumn[],
): string {
  const baseSet = new Set<string>(MANAGED_WAREHOUSE_FACT_TABLE_BASE_COLUMNS);
  const projections: string[] = [];
  // Sort by logical name so the generated SQL is deterministic regardless of
  // the order LS returns columns in.
  const sorted = [...materializedColumns].sort((a, b) =>
    a.columnName.localeCompare(b.columnName),
  );
  for (const col of sorted) {
    const physical = col.physicalColumnName ?? col.columnName;
    if (baseSet.has(col.columnName)) {
      // Defensive: a materialized column shouldn't shadow a base column, but
      // if it does, the base SELECT entry covers it — skip the alias.
      continue;
    }
    projections.push(
      physical === col.columnName
        ? physical
        : `${physical} as ${col.columnName}`,
    );
  }
  const selectList = [...baseSet, ...projections].join(",\n  ");
  return `SELECT\n  ${selectList}\nFROM events
WHERE timestamp BETWEEN '{{startDate}}' AND '{{endDate}}'`;
}
