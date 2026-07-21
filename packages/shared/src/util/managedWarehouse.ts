import type {
  DataSourceInterface,
  DataSourceSettings,
  ExposureQuery,
  GrowthbookClickhouseSettings,
  MaterializedColumn,
  TypedAttributeColumn,
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

export const MANAGED_WAREHOUSE_MIGRATING_MESSAGE =
  "Your managed warehouse is being upgraded to a new storage format. This usually takes a few minutes — querying will be available again shortly.";

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

/**
 * A provisioned managed warehouse whose per-org tables are mid-recreate for the
 * JSON-columns migration. Transient and distinct from never-provisioned — the UI
 * shows an "upgrading" state rather than the "no events sent" onboarding copy.
 */
export function isManagedWarehouseMigrating(
  datasource: Pick<DataSourceInterface, "type" | "settings">,
): boolean {
  if (!isManagedWarehouse(datasource)) {
    return false;
  }
  return (datasource.settings as { migrating?: boolean })?.migrating === true;
}

/**
 * A managed warehouse that can't currently serve queries — either never provisioned
 * or mid-migration. Use to gate query UIs; superset of `isManagedWarehouseAwaitingProvisioning`.
 */
export function isManagedWarehouseUnavailable(
  datasource: Pick<DataSourceInterface, "type" | "settings">,
): boolean {
  return (
    isManagedWarehouseAwaitingProvisioning(datasource) ||
    isManagedWarehouseMigrating(datasource)
  );
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
// Custom (JSON-sourced) identifiers aliased out to top-level join columns: the org's
// hashAttributes plus any `extraIdentifiers` preserved from a legacy migration. The
// same exclusions apply to both (built-in/reserved-collision names, array types) so a
// preserved identifier can't produce duplicate or non-scalar SELECT columns.
export function getManagedWarehouseCustomIdentifiers(
  attributeSchema: SDKAttributeSchema | undefined,
  extraIdentifiers: string[] = [],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const consider = (property: string, isArray: boolean) => {
    // Folds into a built-in identity column (user_id / device_id).
    if (RESERVED_TOP_LEVEL_ATTRIBUTE_KEYS.has(property)) return;
    // Would collide with a real column emitted by `SELECT *`.
    if (MANAGED_WAREHOUSE_RESERVED_COLUMN_NAMES.has(property.toLowerCase()))
      return;
    // Arrays can't be scalar join keys.
    if (isArray) return;
    if (seen.has(property)) return;
    seen.add(property);
    out.push(property);
  };
  for (const a of attributeSchema || []) {
    if (!a.hashAttribute || a.archived) continue;
    consider(a.property, ARRAY_ATTRIBUTE_DATATYPES.has(a.datatype));
  }
  for (const property of extraIdentifiers) {
    // Preserved legacy identifiers are scalar by construction (legacy identifier
    // materialized columns were never arrays).
    consider(property, false);
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
  extraIdentifiers: string[] = [],
): JSONColumnFields {
  const identifiers = new Set(
    getManagedWarehouseCustomIdentifiers(attributeSchema, extraIdentifiers),
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

/**
 * Version of the JSON-ergonomics setup (per-org user settings + typed attribute
 * ALIAS columns). Persisted per warehouse as `settings.jsonErgonomicsVersion`
 * once applied; bump to make the backfill sweep re-apply everywhere.
 */
export const MANAGED_WAREHOUSE_JSON_ERGONOMICS_VERSION = 1;

/**
 * Attributes to expose as typed `attributes.<property>` ALIAS columns on the
 * per-org JSON tables: everything the SDK actually stores inside the
 * `attributes` JSON column — i.e. all non-archived attributes except the keys
 * the SDK extracts to dedicated top-level columns. Identifiers are included
 * (their top-level aliases only exist in fact-table SQL, not on the physical
 * tables that SQL Explorer queries). Dotted names can't collide with real
 * columns, so no reserved-name filtering is needed. Sorted for determinism.
 */
export function getManagedWarehouseTypedAttributeColumns(
  attributeSchema: SDKAttributeSchema | undefined,
  extraIdentifiers: string[] = [],
): TypedAttributeColumn[] {
  const out = new Map<string, TypedAttributeColumn>();
  for (const a of attributeSchema || []) {
    if (a.archived) continue;
    if (RESERVED_TOP_LEVEL_ATTRIBUTE_KEYS.has(a.property)) continue;
    out.set(a.property, {
      property: a.property,
      datatype: a.datatype === "number" ? "number" : "string",
    });
  }
  // Preserved legacy identifiers may be gone from the schema but still queried.
  for (const property of extraIdentifiers) {
    if (RESERVED_TOP_LEVEL_ATTRIBUTE_KEYS.has(property)) continue;
    if (!out.has(property)) {
      out.set(property, { property, datatype: "string" });
    }
  }
  return [...out.values()].sort((a, b) =>
    a.property < b.property ? -1 : a.property > b.property ? 1 : 0,
  );
}

/** Full identifier/userIdType list: built-in identity columns + custom JSON identifiers. */
export function getManagedWarehouseUserIdTypes(
  attributeSchema: SDKAttributeSchema | undefined,
  extraIdentifiers: string[] = [],
): string[] {
  return [
    ...MANAGED_WAREHOUSE_BUILTIN_IDENTIFIERS,
    ...getManagedWarehouseCustomIdentifiers(attributeSchema, extraIdentifiers),
  ];
}

/** userIdTypes shaped for DataSourceSettings (with empty descriptions). */
export function getManagedWarehouseUserIdTypeSettings(
  attributeSchema: SDKAttributeSchema | undefined,
  extraIdentifiers: string[] = [],
): UserIdType[] {
  return getManagedWarehouseUserIdTypes(attributeSchema, extraIdentifiers).map(
    (userIdType) => ({
      userIdType,
      description: "",
    }),
  );
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

// Non-identifier materialized columns (dimensions) preserved from a legacy migration,
// re-exposed as top-level SELECT aliases out of `attributes` (under their legacy column
// name) so bare references keep resolving. Drops any whose name collides with a real
// `SELECT *` column (reserved names) or a custom identifier alias (identifiers win), and
// de-dupes by column name to keep the SELECT valid. The (now-removed) migration that
// wrote `migratedColumns` already excluded reserved names; re-checking here keeps the
// SELECT valid on read even if that invariant drifts (e.g. the reserved set grows in
// a later release), matching the identifier path which re-filters on every read.
function dedupeMigratedDimensions(
  customIdentifiers: string[],
  migratedColumns: MaterializedColumn[],
): MaterializedColumn[] {
  const identifiers = new Set(customIdentifiers);
  const seen = new Set<string>();
  const out: MaterializedColumn[] = [];
  for (const col of migratedColumns) {
    if (
      MANAGED_WAREHOUSE_RESERVED_COLUMN_NAMES.has(
        col.columnName.toLowerCase(),
      ) ||
      identifiers.has(col.columnName) ||
      seen.has(col.columnName)
    )
      continue;
    seen.add(col.columnName);
    out.push(col);
  }
  // Sort for deterministic SQL (stable across persisted-order changes).
  out.sort((a, b) =>
    a.columnName < b.columnName ? -1 : a.columnName > b.columnName ? 1 : 0,
  );
  return out;
}

// Alias a preserved dimension out of the `attributes` JSON column under its legacy
// column name. Numeric columns coerce via toFloat64OrNull (mirroring SqlIntegration's
// jsonExtract numeric path); everything else casts to Nullable(String), like identifiers.
function migratedColumnSelectExpr(col: MaterializedColumn): string {
  const path = `${MANAGED_WAREHOUSE_ATTRIBUTES_COLUMN}.${chIdentifier(
    col.sourceField,
  )}::Nullable(String)`;
  const expr = col.datatype === "number" ? `toFloat64OrNull(${path})` : path;
  return `${expr} AS ${chIdentifier(col.columnName)}`;
}

// The full SELECT-list alias clause for a migrated warehouse: custom identifiers
// (join-key aliases) followed by preserved dimensions, each aliased out of `attributes`.
// Empty when there's nothing to alias. Callers must pass dimensions already deduped
// against the identifiers via `dedupeMigratedDimensions`.
function attributeAliasClause(
  customIdentifiers: string[],
  dimensions: MaterializedColumn[],
): string {
  const exprs = [
    ...customIdentifiers.map(customIdentifierSelectExpr),
    ...dimensions.map(migratedColumnSelectExpr),
  ];
  if (!exprs.length) return "";
  return ",\n  " + exprs.join(",\n  ");
}

/**
 * The SELECT-list alias clause (custom identifiers + preserved dimensions) for a
 * MIGRATED managed warehouse, derived from datasource settings alone. Lets callers
 * without the org attribute schema — e.g. Product Analytics `data_source` explorations
 * that query a per-org table directly — re-expose former columns the same way the
 * `ch_events` fact table does, so bare references keep resolving.
 *
 * Returns "" unless `useJsonColumns` is set: on a pre-migration warehouse these columns
 * are still physical, so `SELECT *, attributes.x AS x` would duplicate a column. Only
 * apply it to per-org tables that carry the `attributes` JSON column (events /
 * experiment_views) — the caller is responsible for that check.
 */
export function buildManagedWarehouseAttributeAliasClause(
  settings: DataSourceSettings | null | undefined,
): string {
  const s = settings as GrowthbookClickhouseSettings | null | undefined;
  if (!s?.useJsonColumns) return "";

  // Mirror getManagedWarehouseCustomIdentifiers: drop builtins (folded into the
  // identity columns) and any name colliding with a real `SELECT *` column, so an
  // unexpected reserved name in persisted `userIdTypes` can't produce a duplicate
  // SELECT alias. Keeps this clause identical to the one the fact table emits.
  const builtins = new Set<string>(MANAGED_WAREHOUSE_BUILTIN_IDENTIFIERS);
  const customIdentifiers = (s.userIdTypes || [])
    .map((u) => u.userIdType)
    .filter(
      (t) =>
        !builtins.has(t) &&
        !MANAGED_WAREHOUSE_RESERVED_COLUMN_NAMES.has(t.toLowerCase()),
    );
  return attributeAliasClause(
    customIdentifiers,
    dedupeMigratedDimensions(customIdentifiers, s.migratedColumns || []),
  );
}

// SQL for the `ch_events` fact table: `SELECT *` exposes the standard + JSON columns;
// custom identifiers are aliased out of the JSON so they can be join keys, and preserved
// dimensions are aliased out under their legacy names so bare references keep resolving.
export function buildManagedWarehouseEventsFactTableSql(
  attributeSchema: SDKAttributeSchema | undefined,
  extraIdentifiers: string[] = [],
  migratedColumns: MaterializedColumn[] = [],
): string {
  const customIdentifiers = getManagedWarehouseCustomIdentifiers(
    attributeSchema,
    extraIdentifiers,
  );
  const dimensionAliases = dedupeMigratedDimensions(
    customIdentifiers,
    migratedColumns,
  );
  return `SELECT *${attributeAliasClause(customIdentifiers, dimensionAliases)}
FROM ${MANAGED_WAREHOUSE_EVENTS_TABLE}
WHERE timestamp BETWEEN '{{startDate}}' AND '{{endDate}}'`;
}

// One exposure query per identifier, reading from `experiment_views`.
export function buildManagedWarehouseExposureQueries(
  attributeSchema: SDKAttributeSchema | undefined,
  extraIdentifiers: string[] = [],
  migratedColumns: MaterializedColumn[] = [],
): ExposureQuery[] {
  const customIdentifiers = getManagedWarehouseCustomIdentifiers(
    attributeSchema,
    extraIdentifiers,
  );
  const dimensionAliases = dedupeMigratedDimensions(
    customIdentifiers,
    migratedColumns,
  );
  const query = `SELECT *${attributeAliasClause(
    customIdentifiers,
    dimensionAliases,
  )}
FROM ${MANAGED_WAREHOUSE_EXPERIMENT_VIEWS_TABLE}
WHERE
  experiment_id LIKE '{{ experimentId }}'
  AND timestamp BETWEEN '{{startDate}}' AND '{{endDate}}'`;

  // Re-expose preserved dimensions as breakdown options so pre-migration custom
  // breakdowns keep working (the aliased columns resolve in the query above).
  const dimensions = [
    ...MANAGED_WAREHOUSE_DEFAULT_DIMENSIONS,
    ...dimensionAliases
      .map((c) => c.columnName)
      .filter((c) => !MANAGED_WAREHOUSE_DEFAULT_DIMENSIONS.includes(c)),
  ];

  return getManagedWarehouseUserIdTypes(attributeSchema, extraIdentifiers).map(
    (identifier) => ({
      id: identifier,
      name: identifier,
      userIdType: identifier,
      dimensions,
      query,
    }),
  );
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

// Base columns (with non-identifier attributes attached as `attributes` JSON fields)
// plus one column per custom identifier and one per preserved (migrated) dimension.
export function getManagedWarehouseEventsFactTableColumns(
  attributeSchema: SDKAttributeSchema | undefined,
  extraIdentifiers: string[] = [],
  migratedColumns: MaterializedColumn[] = [],
): ManagedWarehouseFactColumn[] {
  const customIdentifiers = getManagedWarehouseCustomIdentifiers(
    attributeSchema,
    extraIdentifiers,
  );
  const dimensionAliases = dedupeMigratedDimensions(
    customIdentifiers,
    migratedColumns,
  );
  const jsonFields = getManagedWarehouseAttributesJsonFields(
    attributeSchema,
    extraIdentifiers,
  );
  const base: ManagedWarehouseFactColumn[] =
    MANAGED_WAREHOUSE_EVENTS_BASE_COLUMNS.map((c) =>
      c.column === MANAGED_WAREHOUSE_ATTRIBUTES_COLUMN
        ? { ...c, jsonFields }
        : c,
    );
  const custom: ManagedWarehouseFactColumn[] = customIdentifiers.map(
    (property) => ({
      column: property,
      datatype: "string",
    }),
  );
  // Preserved dimensions are real top-level columns (via the SELECT alias), so a bare
  // metric ref to one validates without any rewrite. A live attribute also remains an
  // `attributes.<field>` JSON field; that duplicate listing is harmless (both resolve).
  const dimensions: ManagedWarehouseFactColumn[] = dimensionAliases.map(
    (col) => ({ column: col.columnName, datatype: col.datatype }),
  );
  return [...base, ...custom, ...dimensions];
}
