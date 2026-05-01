import type { DataSourceInterface } from "shared/types/datasource";

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
