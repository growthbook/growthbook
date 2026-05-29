import type {
  DataSourceInterface,
  ExposureQuery,
  UserIdType,
} from "shared/types/datasource";
import type { SDKAttributeSchema } from "shared/types/organization";
import type { FactTableColumnType } from "shared/types/fact-table";

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

// ---------------------------------------------------------------------------
// Managed Warehouse JSON columns (replacing materialized columns)
//
// In the JSON-columns model the per-org ClickHouse tables always carry the
// SDK's standard top-level fields as real columns, plus `attributes` /
// `properties` as native JSON columns for the custom long tail. Identifiers
// (org attributes with `hashAttribute: true`) are exposed as top-level columns:
//   - the built-in identity columns `user_id` / `device_id` are always present
//   - any *custom* hashAttribute is aliased out of the `attributes` JSON column
//     in the fact-table / exposure-query SELECT.
// ---------------------------------------------------------------------------

/** Name of the per-org events table the managed-warehouse fact table reads. */
export const MANAGED_WAREHOUSE_EVENTS_TABLE = "events";
/** Name of the per-org table that holds Experiment Viewed events. */
export const MANAGED_WAREHOUSE_EXPERIMENT_VIEWS_TABLE = "experiment_views";
/** Fact-table / per-org column holding the user attribute context (context_json) as JSON. */
export const MANAGED_WAREHOUSE_ATTRIBUTES_COLUMN = "attributes";

/** Built-in identity columns — always present and always used as userIdTypes. */
export const MANAGED_WAREHOUSE_BUILTIN_IDENTIFIERS = [
  "user_id",
  "device_id",
] as const;

/**
 * Attribute `property` names that the SDK folds into the built-in identity
 * columns (see parseAttributes in sdk-js growthbook-tracking.ts). A
 * hashAttribute using one of these is already covered by the built-in
 * identifiers, so it is not treated as a separate custom identifier.
 */
const BUILTIN_IDENTIFIER_ATTRIBUTE_KEYS = new Set([
  "user_id",
  "device_id",
  "anonymous_id",
  "id",
]);

/**
 * All attribute `property` names the SDK extracts to dedicated top-level
 * columns (so they are NOT inside the `attributes` JSON column). Custom
 * identifiers must not be one of these. Mirrors parseAttributes in
 * sdk-js/src/plugins/growthbook-tracking.ts.
 */
const RESERVED_TOP_LEVEL_ATTRIBUTE_KEYS = new Set([
  ...BUILTIN_IDENTIFIER_ATTRIBUTE_KEYS,
  "page_id",
  "session_id",
  "utmCampaign",
  "utmContent",
  "utmMedium",
  "utmSource",
  "utmTerm",
  "pageTitle",
]);

/**
 * Default experiment dimensions for generated exposure queries. These are
 * always-present standard top-level columns in the per-org tables.
 */
export const MANAGED_WAREHOUSE_DEFAULT_DIMENSIONS = [
  "geo_country",
  "ua_browser",
  "ua_os",
  "ua_device_type",
  "utm_source",
  "utm_medium",
  "utm_campaign",
];

/**
 * Every column name produced by `SELECT *` on the per-org tables (base event
 * columns + the JSON columns + all standard top-level fields + the derived
 * experiment/feature columns). A custom identifier alias must not collide with
 * one of these, otherwise `SELECT *, attributes.x AS x` would emit a duplicate
 * column and ClickHouse would reject the query. Kept in sync with the license
 * server's per-org table column list (`tempTopLevelFields` + remaining + base).
 */
const MANAGED_WAREHOUSE_RESERVED_COLUMN_NAMES = new Set(
  [
    // Base event columns + JSON columns
    "timestamp",
    "client_key",
    "event_name",
    "properties",
    "attributes",
    // Remaining always-written columns
    "environment",
    "sdk_language",
    "sdk_version",
    "event_uuid",
    "ip",
    // Standard top-level fields (SDK + ingestor enrichment)
    "user_id",
    "device_id",
    "page_id",
    "session_id",
    "page_title",
    "url",
    "url_path",
    "url_host",
    "url_query",
    "url_fragment",
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_content",
    "geo_country",
    "geo_city",
    "geo_lat",
    "geo_lon",
    "ua",
    "ua_browser",
    "ua_os",
    "ua_device_type",
    // Derived columns on experiment_views / feature_usage
    "experiment_id",
    "variation_id",
    "feature",
    "revision",
    "source",
    "value",
    "ruleid",
    "variationid",
  ].map((c) => c.toLowerCase()),
);

/** Array-typed attributes can't be scalar string/number join keys. */
const ARRAY_ATTRIBUTE_DATATYPES = new Set([
  "string[]",
  "number[]",
  "secureString[]",
]);

/**
 * Custom identifiers = hashAttribute attributes that live inside the
 * `attributes` JSON column (i.e. not one of the SDK's reserved top-level keys).
 * The property name doubles as the JSON path, the alias, and the userIdType.
 */
export function getManagedWarehouseCustomIdentifiers(
  attributeSchema: SDKAttributeSchema | undefined,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const a of attributeSchema || []) {
    if (!a.hashAttribute || a.archived) continue;
    // Folds into a built-in identity column (user_id / device_id).
    if (RESERVED_TOP_LEVEL_ATTRIBUTE_KEYS.has(a.property)) continue;
    // Would collide with a real column emitted by `SELECT *`.
    if (MANAGED_WAREHOUSE_RESERVED_COLUMN_NAMES.has(a.property.toLowerCase()))
      continue;
    // Arrays can't be scalar join keys.
    if (ARRAY_ATTRIBUTE_DATATYPES.has(a.datatype)) continue;
    if (seen.has(a.property)) continue;
    seen.add(a.property);
    out.push(a.property);
  }
  // Sort for deterministic SQL (stable across attribute-schema reordering).
  out.sort();
  return out;
}

/** Full identifier/userIdType list: built-in identity columns + custom JSON identifiers. */
export function getManagedWarehouseUserIdTypes(
  attributeSchema: SDKAttributeSchema | undefined,
): string[] {
  return [
    ...MANAGED_WAREHOUSE_BUILTIN_IDENTIFIERS,
    ...getManagedWarehouseCustomIdentifiers(attributeSchema),
  ];
}

/** userIdTypes shaped for DataSourceSettings (with empty descriptions). */
export function getManagedWarehouseUserIdTypeSettings(
  attributeSchema: SDKAttributeSchema | undefined,
): UserIdType[] {
  return getManagedWarehouseUserIdTypes(attributeSchema).map((userIdType) => ({
    userIdType,
    description: "",
  }));
}

/** Quote a ClickHouse identifier (column/alias/JSON path segment) with backticks. */
function chQuoteIdentifier(name: string): string {
  return "`" + name.replace(/`/g, "``") + "`";
}

const SAFE_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/** A bare identifier when safe, otherwise backtick-quoted. */
function chIdentifier(name: string): string {
  return SAFE_IDENTIFIER.test(name) ? name : chQuoteIdentifier(name);
}

/**
 * SELECT-list expression aliasing a custom identifier out of the `attributes`
 * JSON column. Cast to String since identifier columns are string-compared
 * join keys. (SELECT-list aliases over JSON perform well — see issue #91434.)
 */
function customIdentifierSelectExpr(property: string): string {
  const path = `${MANAGED_WAREHOUSE_ATTRIBUTES_COLUMN}.${chIdentifier(
    property,
  )}::String`;
  return `${path} AS ${chIdentifier(property)}`;
}

function customIdentifierAliasClause(
  attributeSchema: SDKAttributeSchema | undefined,
): string {
  const custom = getManagedWarehouseCustomIdentifiers(attributeSchema);
  if (!custom.length) return "";
  return (
    ",\n  " +
    custom.map((property) => customIdentifierSelectExpr(property)).join(",\n  ")
  );
}

/**
 * SQL for the managed-warehouse `ch_events` fact table. `SELECT *` exposes the
 * always-present standard columns + the `attributes`/`properties` JSON columns;
 * custom identifiers are aliased out of the JSON so they can be used as join keys.
 */
export function buildManagedWarehouseEventsFactTableSql(
  attributeSchema: SDKAttributeSchema | undefined,
): string {
  return `SELECT *${customIdentifierAliasClause(attributeSchema)}
FROM ${MANAGED_WAREHOUSE_EVENTS_TABLE}
WHERE timestamp BETWEEN '{{startDate}}' AND '{{endDate}}'`;
}

/**
 * One exposure query per identifier, reading from `experiment_views`. Custom
 * identifiers are aliased out of the `attributes` JSON; built-ins are real columns.
 */
export function buildManagedWarehouseExposureQueries(
  attributeSchema: SDKAttributeSchema | undefined,
): ExposureQuery[] {
  const query = `SELECT *${customIdentifierAliasClause(attributeSchema)}
FROM ${MANAGED_WAREHOUSE_EXPERIMENT_VIEWS_TABLE}
WHERE
  experiment_id LIKE '{{ experimentId }}'
  AND timestamp BETWEEN '{{startDate}}' AND '{{endDate}}'`;

  return getManagedWarehouseUserIdTypes(attributeSchema).map((identifier) => ({
    id: identifier,
    name: identifier,
    userIdType: identifier,
    dimensions: MANAGED_WAREHOUSE_DEFAULT_DIMENSIONS,
    query,
  }));
}

export type ManagedWarehouseFactColumn = {
  column: string;
  datatype: FactTableColumnType;
  alwaysInlineFilter?: boolean;
};

/**
 * Always-present columns of the managed-warehouse `ch_events` fact table in the
 * JSON-columns model: the SDK's standard top-level fields plus the `attributes`
 * and `properties` JSON columns. Custom identifiers are appended on top.
 */
const MANAGED_WAREHOUSE_EVENTS_BASE_COLUMNS: ManagedWarehouseFactColumn[] = [
  { column: "timestamp", datatype: "date" },
  { column: "user_id", datatype: "string" },
  { column: "device_id", datatype: "string" },
  { column: "properties", datatype: "json" },
  { column: "attributes", datatype: "json" },
  { column: "event_name", datatype: "string", alwaysInlineFilter: true },
  { column: "client_key", datatype: "string" },
  { column: "environment", datatype: "string" },
  { column: "sdk_language", datatype: "string" },
  { column: "sdk_version", datatype: "string" },
  { column: "event_uuid", datatype: "string" },
  { column: "ip", datatype: "string" },
  { column: "geo_country", datatype: "string" },
  { column: "ua_device_type", datatype: "string" },
  { column: "ua_browser", datatype: "string" },
  { column: "ua_os", datatype: "string" },
  { column: "utm_source", datatype: "string" },
  { column: "utm_medium", datatype: "string" },
  { column: "utm_campaign", datatype: "string" },
  { column: "url_path", datatype: "string" },
];

/**
 * Column descriptors for the managed-warehouse `ch_events` fact table: the
 * always-present base columns plus one (String) column per custom identifier.
 */
export function getManagedWarehouseEventsFactTableColumns(
  attributeSchema: SDKAttributeSchema | undefined,
): ManagedWarehouseFactColumn[] {
  const custom: ManagedWarehouseFactColumn[] =
    getManagedWarehouseCustomIdentifiers(attributeSchema).map((property) => ({
      column: property,
      datatype: "string",
    }));
  return [...MANAGED_WAREHOUSE_EVENTS_BASE_COLUMNS, ...custom];
}
