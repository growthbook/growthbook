/**
 * Local helpers used to seed a freshly-created Managed Warehouse datasource's
 * `userIdTypes`, `queries.exposure`, and `syncedMaterializedColumns`. Lives
 * here only so warehouse creation doesn't need a network round-trip for pure
 * compute. The authoritative version lives in
 * `central-license-server/src/services/managedWarehouseAttributes.ts` and
 * runs on every attributeSchema change. Drift is bounded — anything wrong in
 * the seed gets reconciled on the first attribute write.
 *
 * Column-name validation is mirrored from the LS so the seed can drop
 * attributes whose `property` can't be used as a ClickHouse identifier.
 * Without the filter, an org with a pre-existing invalid attribute name
 * (e.g. `$groups`) would create a warehouse whose CREATE TABLE / ADD COLUMN
 * DDL fails with a CH syntax error.
 */
import { MANAGED_WAREHOUSE_USER_ATTR_PREFIX } from "shared/constants";
import type { MaterializedColumn } from "shared/types/datasource";
import type { FactTableColumnType } from "shared/types/fact-table";
import type { SDKAttribute } from "shared/types/organization";
import { logger } from "back-end/src/util/logger";

type ClickHouseDataType =
  | "DateTime"
  | "Float64"
  | "Boolean"
  | "String"
  | "LowCardinality(String)"
  | "Array(String)"
  | "Array(Float64)";

const WAREHOUSE_BUILTIN_FIELD_TYPES: Record<string, ClickHouseDataType> = {
  user_id: "String",
  url: "String",
  url_path: "String",
  url_host: "String",
  url_query: "String",
  url_fragment: "String",
  device_id: "String",
  page_id: "String",
  session_id: "String",
  page_title: "String",
  utm_source: "String",
  utm_medium: "String",
  utm_campaign: "String",
  utm_term: "String",
  utm_content: "String",
  geo_country: "String",
  geo_city: "String",
  geo_lat: "Float64",
  geo_lon: "Float64",
  ua: "String",
  ua_browser: "String",
  ua_os: "String",
  ua_device_type: "String",
};

function clickhouseTypeToFactTableType(
  type: ClickHouseDataType,
): FactTableColumnType {
  switch (type) {
    case "Float64":
    case "Array(Float64)":
      return "number";
    case "Boolean":
      return "boolean";
    case "DateTime":
      return "date";
    case "String":
    case "LowCardinality(String)":
    case "Array(String)":
      return "string";
  }
}

const WAREHOUSE_BUILTIN_COLUMNS: MaterializedColumn[] = Object.entries(
  WAREHOUSE_BUILTIN_FIELD_TYPES,
).map(([name, type]) => ({
  columnName: name,
  sourceField: name,
  datatype: clickhouseTypeToFactTableType(type),
  type: "dimension",
}));

/**
 * SDK auto-wrapper attribute names (typically camelCase) that semantically
 * duplicate a snake_case warehouse built-in. The GrowthBook JS SDK writes
 * BOTH halves of every entry below from the same source — e.g. parsing a
 * URL's query produces both `utmSource` (into the `attributes` JSON for
 * targeting) and `utm_source` (into the ingestor envelope as a top-level
 * field) — so materializing the user attribute as a separate column would
 * just be a duplicate of the built-in.
 *
 * When a user attribute's `property` is keyed here:
 *   - We skip materializing it as its own column (it would be duplicate data)
 *   - If the attribute has `hashAttribute: true`, the matching built-in is
 *     promoted to `identifier` so SDK targeting against the attribute still
 *     has a corresponding warehouse identifier
 *
 * Keep this map in lockstep with the LS-side copy in
 * `central-license-server/src/services/managedWarehouseAttributes.ts`.
 */
const SDK_ATTRIBUTE_TO_BUILTIN_ALIAS: Record<string, string> = {
  // Default attributes seeded on every org (see OrganizationModel.ts):
  id: "user_id",
  path: "url_path",
  host: "url_host",
  query: "url_query",
  deviceType: "ua_device_type",
  browser: "ua_browser",
  utmSource: "utm_source",
  utmMedium: "utm_medium",
  utmCampaign: "utm_campaign",
  utmTerm: "utm_term",
  utmContent: "utm_content",
  // Other common SDK auto-wrapper attributes — included so an org that
  // expanded their schema beyond the defaults still benefits from shadowing:
  deviceId: "device_id",
  pageId: "page_id",
  sessionId: "session_id",
  pageTitle: "page_title",
  urlPath: "url_path",
  urlHost: "url_host",
  urlQuery: "url_query",
  urlFragment: "url_fragment",
};

// Mirrors central-license-server's `RESERVED_MANAGED_WAREHOUSE_COLUMN_NAMES`
// (lowercased base-table columns + ingestor-written remaining columns).
const RESERVED_MANAGED_WAREHOUSE_COLUMN_NAMES: ReadonlySet<string> = new Set(
  [
    "timestamp",
    "client_key",
    "event_name",
    "properties",
    "attributes",
    "experiment_id",
    "variation_id",
    "environment",
    "sdk_language",
    "sdk_version",
    "event_uuid",
    "ip",
  ].map((c) => c.toLowerCase()),
);

// Mirrors central-license-server's `MANAGED_WAREHOUSE_SQL_KEYWORD_BLOCKLIST`.
const MANAGED_WAREHOUSE_SQL_KEYWORD_BLOCKLIST: ReadonlySet<string> = new Set([
  "select",
  "from",
  "where",
  "order",
  "having",
  "limit",
  "offset",
  "join",
  "on",
  "using",
  "as",
  "distinct",
  "union",
  "if",
  "then",
  "else",
  "end",
  "case",
  "when",
  "and",
  "or",
  "not",
  "true",
  "false",
  "null",
  "is",
  "in",
  "between",
  "exists",
  "like",
  "array",
  "tuple",
  "map",
  "cast",
  "inf",
  "infinity",
  "nan",
  "default",
  "current_date",
  "current_timestamp",
  "sysdate",
]);

const CLICKHOUSE_IDENTIFIER_REGEX = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const MANAGED_WAREHOUSE_COLUMN_NAME_MAX_LENGTH = 128;

/**
 * Returns `undefined` when the name is safe to use as an unquoted ClickHouse
 * column on a Managed Warehouse, or a human-readable reason otherwise.
 * Mirrors `validateManagedWarehouseColumnName` in central-license-server so
 * the seed snapshot can reject names that the LS sync would also reject.
 */
export function validateManagedWarehouseColumnName(
  name: string,
): string | undefined {
  if (name.length > MANAGED_WAREHOUSE_COLUMN_NAME_MAX_LENGTH) {
    return `Attribute name "${name}" is too long for a Managed Warehouse column (max ${MANAGED_WAREHOUSE_COLUMN_NAME_MAX_LENGTH} characters).`;
  }
  if (!CLICKHOUSE_IDENTIFIER_REGEX.test(name)) {
    return `Attribute name "${name}" can't be used as a Managed Warehouse column — names must start with a letter or underscore and contain only alphanumerics and underscores.`;
  }
  const lowered = name.toLowerCase();
  if (RESERVED_MANAGED_WAREHOUSE_COLUMN_NAMES.has(lowered)) {
    return `Attribute name "${name}" collides with a reserved Managed Warehouse column.`;
  }
  if (MANAGED_WAREHOUSE_SQL_KEYWORD_BLOCKLIST.has(lowered)) {
    return `Attribute name "${name}" is a SQL keyword and can't be used as a Managed Warehouse column.`;
  }
  return undefined;
}

function materializedColumnTypeFromAttribute(
  datatype: SDKAttribute["datatype"],
):
  | { datatype: FactTableColumnType; arrayElementType?: "string" | "number" }
  | undefined {
  switch (datatype) {
    case "string":
    case "enum":
      return { datatype: "string" };
    case "number":
      return { datatype: "number" };
    case "boolean":
      return { datatype: "boolean" };
    case "string[]":
      return { datatype: "string", arrayElementType: "string" };
    case "number[]":
      return { datatype: "number", arrayElementType: "number" };
    // secureString is SHA256-hashed at the SDK; materializing it as plaintext
    // would defeat the purpose. Match the LS-side derivation by skipping.
    case "secureString":
    case "secureString[]":
      return undefined;
  }
}

/**
 * Derive the materialized columns for an org's attributeSchema plus the
 * warehouse's built-in (ingestor-enriched + SDK top-level) columns. Used to
 * seed a freshly-created Managed Warehouse datasource.
 *
 * Identifier semantics: only scalar string/number attributes with
 * `hashAttribute: true` are identifiers (this guard is critical — flipping
 * it would silently corrupt experiments by feeding non-identifier columns
 * into `userIdTypes`).
 *
 * Attributes whose `property` can't be used as a ClickHouse identifier are
 * skipped (and logged). Without this the seed would push invalid names into
 * the snapshot and break the first CREATE TABLE / ADD COLUMN run.
 *
 * Attributes listed in `SDK_ATTRIBUTE_TO_BUILTIN_ALIAS` are not materialized
 * as their own columns — the SDK auto-wrapper double-writes them as
 * snake_case top-level fields that the ingestor already exposes as built-in
 * columns, so a per-attribute column would just be duplicate data. The
 * attribute's `hashAttribute: true` flag (if set) is forwarded to the
 * built-in so identifier targeting still works.
 */
export function getWarehouseMaterializedColumns(
  attributes: SDKAttribute[],
  {
    orgId,
    existingColumnNames,
  }: {
    orgId?: string;
    /** Union of `columnName` + `sourceField` values from any prior snapshot
     *  — i.e. the names under which a column may already be materializing
     *  an attribute. Attributes whose `property` appears here skip the SDK
     *  alias shadow so their existing column isn't silently dropped.
     *
     *  In production, the GB-side `getWarehouseMaterializedColumns` is only
     *  called from the brand-new-datasource seed path (datasources.ts
     *  controller) which has no snapshot — so callers don't pass this. The
     *  parameter exists for parity with the LS-side derivation (where it
     *  IS load-bearing) and to keep the unit tests for both sides
     *  symmetric. */
    existingColumnNames?: ReadonlySet<string>;
  } = {},
): MaterializedColumn[] {
  const attributeColumns: MaterializedColumn[] = [];
  // Built-ins that should be promoted from "dimension" to "identifier" because
  // an SDK-aliased attribute targeting them had `hashAttribute: true`.
  const promotedIdentifierBuiltins = new Set<string>();
  for (const attr of attributes) {
    if (attr.archived) continue;
    const matColType = materializedColumnTypeFromAttribute(attr.datatype);
    // Some datatypes (e.g. secureString) are intentionally not materialized.
    if (!matColType) continue;
    const invalidReason = validateManagedWarehouseColumnName(attr.property);
    if (invalidReason) {
      logger.warn(
        {
          orgId,
          property: attr.property,
          reason: invalidReason,
        },
        "Skipping attribute from Managed Warehouse seed (invalid column name)",
      );
      continue;
    }
    const isArray = !!matColType.arrayElementType;
    // `enum` materializes as a string column, so an enum attribute with
    // `hashAttribute: true` should be treated as an identifier — same as
    // `string`. Without this, the seed would write the attribute as a
    // dimension and produce an empty `userIdTypes` entry until the first
    // LS sync reconciles it.
    const canBeIdentifier =
      !isArray &&
      (attr.datatype === "string" ||
        attr.datatype === "number" ||
        attr.datatype === "enum");
    const isIdentifier = canBeIdentifier && attr.hashAttribute === true;

    // Shadow SDK auto-wrapper duplicates. If the attribute property is keyed
    // in the alias map AND the corresponding built-in actually exists, skip
    // materialization (the built-in carries the same data). Forward the
    // identifier role if the attribute had it; otherwise the built-in stays
    // a dimension. Array-typed attrs are excluded — no built-in is an array.
    //
    // Don't shadow when the column already exists — historical data lives in
    // the customer's column, not the snake_case builtin (which may be empty
    // for non-JS-SDK ingestion paths that only populated camelCase). Letting
    // the column live alongside the builtin avoids a silent DROP COLUMN
    // followed by metric/dimension breakage.
    const aliasedBuiltin = SDK_ATTRIBUTE_TO_BUILTIN_ALIAS[attr.property];
    if (
      !isArray &&
      aliasedBuiltin !== undefined &&
      WAREHOUSE_BUILTIN_FIELD_TYPES[aliasedBuiltin] !== undefined &&
      !existingColumnNames?.has(attr.property)
    ) {
      if (isIdentifier) promotedIdentifierBuiltins.add(aliasedBuiltin);
      continue;
    }

    attributeColumns.push({
      columnName: attr.property,
      // User attribute columns are physically stored with a prefix so any
      // future built-in column can't collide with an arbitrary attribute
      // name. The fact-table SQL exposes them under the unprefixed name.
      physicalColumnName: MANAGED_WAREHOUSE_USER_ATTR_PREFIX + attr.property,
      sourceField: attr.property,
      datatype: matColType.datatype,
      type: isIdentifier ? "identifier" : "dimension",
      arrayElementType: matColType.arrayElementType,
    });
  }

  const attributeColumnNames = new Set(
    attributeColumns.map((c) => c.columnName),
  );
  const unshadowedBuiltins = WAREHOUSE_BUILTIN_COLUMNS.filter(
    (c) => !attributeColumnNames.has(c.columnName),
  ).map((c) =>
    promotedIdentifierBuiltins.has(c.columnName)
      ? { ...c, type: "identifier" as const }
      : c,
  );
  return [...attributeColumns, ...unshadowedBuiltins];
}

const DEFAULT_EXPOSURE_QUERY_SQL = `
SELECT *
FROM experiment_views
WHERE
  experiment_id LIKE '{{ experimentId }}'
  AND timestamp BETWEEN '{{startDate}}' AND '{{endDate}}'`.trim();

/**
 * Auto-generated `userIdTypes` + default exposure queries for the identifier
 * columns in a Managed Warehouse's column list. License-server regenerates
 * these on every sync; growthbook needs them locally to seed the datasource
 * at creation time so the UI shows useful defaults before the first sync.
 */
export function getManagedWarehouseDerivedSettings(
  materializedColumns: MaterializedColumn[],
): {
  userIdTypes: { userIdType: string; description: string }[];
  exposureQueries: {
    id: string;
    dimensions: string[];
    name: string;
    userIdType: string;
    query: string;
  }[];
} {
  const identifierColumns = materializedColumns.filter(
    (c) => c.type === "identifier",
  );
  const dimensions = materializedColumns
    .filter((c) => c.type === "dimension")
    .map((c) => c.columnName);

  const userIdTypes = identifierColumns.map((c) => ({
    userIdType: c.columnName,
    description: "",
  }));

  const exposureQueries = identifierColumns.map((c) => ({
    id: c.columnName,
    dimensions,
    name: c.columnName,
    userIdType: c.columnName,
    query: DEFAULT_EXPOSURE_QUERY_SQL,
  }));

  return { userIdTypes, exposureQueries };
}
