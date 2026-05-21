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
 */
export function getWarehouseMaterializedColumns(
  attributes: SDKAttribute[],
  { orgId }: { orgId?: string } = {},
): MaterializedColumn[] {
  const attributeColumns: MaterializedColumn[] = [];
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
    const canBeIdentifier =
      !isArray && (attr.datatype === "string" || attr.datatype === "number");
    const isIdentifier = canBeIdentifier && attr.hashAttribute === true;
    attributeColumns.push({
      columnName: attr.property,
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
