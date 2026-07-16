import type {
  DataSourceInterface,
  ExposureQuery,
  GrowthbookClickhouseSettings,
  UserIdType,
} from "shared/types/datasource";
import type {
  SDKAttributeSchema,
  SDKAttributeType,
} from "shared/types/organization";
import type {
  FactTableColumnType,
  JSONColumnFields,
} from "shared/types/fact-table";

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
 * Managed Warehouse is backed by the growthbook_clickhouse datasource type.
 * Because GrowthBook owns the warehouse compute, we enable query optimizations
 * (e.g. multi-metric queries) for it even on non-enterprise plans.
 */
export function isManagedWarehouse(
  datasource: Pick<DataSourceInterface, "type">,
): boolean {
  return datasource.type === "growthbook_clickhouse";
}

/**
 * Managed Warehouse rows created before provisioning was deferred will not
 * have this flag; treat them as provisioned.
 */
export function isManagedWarehouseAwaitingProvisioning(
  datasource: Pick<DataSourceInterface, "type" | "settings">,
): boolean {
  if (!isManagedWarehouse(datasource)) {
    return false;
  }
  const settings = datasource.settings as {
    hasBeenProvisioned?: boolean;
  };
  return settings?.hasBeenProvisioned === false;
}

// Managed Warehouse JSON-columns model (replaces materialized columns). Per-org
// tables carry the SDK's standard fields as real columns plus `attributes` /
// `properties` JSON columns. Identifiers come from `hashAttribute` attributes:
// user_id/device_id are always present; custom ones are aliased out of `attributes`.

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

// Attribute keys the SDK folds into user_id/device_id (see parseAttributes in
// sdk-js growthbook-tracking.ts), so a hashAttribute on one isn't a custom identifier.
const BUILTIN_IDENTIFIER_ATTRIBUTE_KEYS = new Set([
  "user_id",
  "device_id",
  "anonymous_id",
  "id",
]);

// Attribute keys the SDK extracts to dedicated top-level columns (so they're not
// inside `attributes`); a custom identifier must not be one. Mirrors parseAttributes.
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

// Default exposure-query dimensions; all always-present top-level columns.
export const MANAGED_WAREHOUSE_DEFAULT_DIMENSIONS = [
  "geo_country",
  "ua_browser",
  "ua_os",
  "ua_device_type",
  "utm_source",
  "utm_medium",
  "utm_campaign",
];

// Column names emitted by `SELECT *` on the per-org tables. A custom identifier
// alias must not collide with one, else `SELECT *, attributes.x AS x` duplicates a
// column and ClickHouse rejects the query. Keep in sync with the license server.
export const MANAGED_WAREHOUSE_RESERVED_COLUMN_NAMES = new Set(
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

// Custom identifiers: hashAttribute attributes stored inside `attributes` JSON.
// The property name doubles as the JSON path, the alias, and the userIdType.
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

/** Map an SDK attribute datatype to the fact-table column type used for JSON fields. */
function attributeDatatypeToFactColumnType(
  datatype: SDKAttributeType,
): FactTableColumnType {
  switch (datatype) {
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "string[]":
    case "number[]":
    case "secureString[]":
      return "other";
    default:
      // string, secureString, enum, "" — all treated as string.
      return "string";
  }
}

// Non-identifier attributes that live inside the `attributes` JSON column,
// exposed as `attributes.<field>` pseudo-columns (with the attribute's declared
// type) so they're discoverable without being materialized. Identifiers and
// reserved keys are aliased/extracted to top-level columns, so they're excluded.
export function getManagedWarehouseAttributesJsonFields(
  attributeSchema: SDKAttributeSchema | undefined,
): JSONColumnFields {
  const identifiers = new Set(
    getManagedWarehouseCustomIdentifiers(attributeSchema),
  );
  const fields: JSONColumnFields = {};
  for (const a of attributeSchema || []) {
    if (a.archived) continue;
    // Extracted by the SDK to a dedicated top-level column (not in `attributes`).
    if (RESERVED_TOP_LEVEL_ATTRIBUTE_KEYS.has(a.property)) continue;
    // Collides with a real top-level column; prefer that column.
    if (MANAGED_WAREHOUSE_RESERVED_COLUMN_NAMES.has(a.property.toLowerCase()))
      continue;
    // Aliased out to a top-level identifier column.
    if (identifiers.has(a.property)) continue;
    fields[a.property] = {
      datatype: attributeDatatypeToFactColumnType(a.datatype),
    };
  }
  return fields;
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

// Built-in identifier folding for JSON-column warehouses, mirroring
// parseAttributes in the growthbook-tracking SDK plugin: the `user_id` attribute
// maps to the `user_id` column; `device_id`, `anonymous_id`, and `id` all map to
// the `device_id` column. Any other attribute is a custom identifier whose column
// name equals the attribute property.
const BUILTIN_ATTRIBUTE_TO_IDENTIFIER: Record<string, string> = {
  user_id: "user_id",
  device_id: "device_id",
  anonymous_id: "device_id",
  id: "device_id",
};

// Resolve the managed-warehouse identifier column (which doubles as the exposure
// query's userIdType) that a hash attribute maps to. Legacy materialized-column
// warehouses return the stored SQL column, or null when the attribute isn't an
// identifier. JSON-column warehouses fold built-ins per BUILTIN_ATTRIBUTE_TO_IDENTIFIER
// and treat any other attribute as a custom identifier named after the property.
export function getManagedWarehouseIdentifierForAttribute({
  settings,
  attribute,
}: {
  settings: GrowthbookClickhouseSettings;
  attribute: string;
}): string | null {
  const materializedColumns = settings.materializedColumns || [];
  if (materializedColumns.length) {
    const column = materializedColumns.find(
      (c) => c.type === "identifier" && c.sourceField === attribute,
    )?.columnName;
    return column ?? null;
  }
  return BUILTIN_ATTRIBUTE_TO_IDENTIFIER[attribute] ?? attribute;
}

// Resolve the exposure query (Experiment Assignment Query) a hash attribute maps
// to on a managed warehouse, using the identifier mapping stored in the datasource
// settings. Returns "" when no query matches.
export function getManagedWarehouseExposureQueryIdForAttribute({
  settings,
  attribute,
}: {
  settings: GrowthbookClickhouseSettings;
  attribute: string;
}): string {
  const identifier = getManagedWarehouseIdentifierForAttribute({
    settings,
    attribute,
  });
  if (!identifier) return "";
  const query = (settings.queries?.exposure || []).find(
    (q) => q.userIdType === identifier,
  );
  return query?.id ?? "";
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

// Alias a custom identifier out of the `attributes` JSON column. Cast to
// Nullable(String) (mirroring SqlIntegration's jsonExtract) so off-type values
// coerce to their string form and missing paths stay NULL, rather than ::String
// which only surfaces String-typed values.
function customIdentifierSelectExpr(property: string): string {
  const path = `${MANAGED_WAREHOUSE_ATTRIBUTES_COLUMN}.${chIdentifier(
    property,
  )}::Nullable(String)`;
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

// SQL for the `ch_events` fact table: `SELECT *` exposes the standard + JSON
// columns; custom identifiers are aliased out of the JSON so they can be join keys.
export function buildManagedWarehouseEventsFactTableSql(
  attributeSchema: SDKAttributeSchema | undefined,
): string {
  return `SELECT *${customIdentifierAliasClause(attributeSchema)}
FROM ${MANAGED_WAREHOUSE_EVENTS_TABLE}
WHERE timestamp BETWEEN '{{startDate}}' AND '{{endDate}}'`;
}

// One exposure query per identifier, reading from `experiment_views`.
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
  jsonFields?: JSONColumnFields;
};

// Always-present `ch_events` fact-table columns (standard fields + JSON columns);
// custom identifiers are appended on top.
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

// Base columns (with non-identifier attributes attached as `attributes` JSON
// fields) plus one String column per custom identifier.
export function getManagedWarehouseEventsFactTableColumns(
  attributeSchema: SDKAttributeSchema | undefined,
): ManagedWarehouseFactColumn[] {
  const jsonFields = getManagedWarehouseAttributesJsonFields(attributeSchema);
  const base: ManagedWarehouseFactColumn[] =
    MANAGED_WAREHOUSE_EVENTS_BASE_COLUMNS.map((c) =>
      c.column === MANAGED_WAREHOUSE_ATTRIBUTES_COLUMN
        ? { ...c, jsonFields }
        : c,
    );
  const custom: ManagedWarehouseFactColumn[] =
    getManagedWarehouseCustomIdentifiers(attributeSchema).map((property) => ({
      column: property,
      datatype: "string",
    }));
  return [...base, ...custom];
}
