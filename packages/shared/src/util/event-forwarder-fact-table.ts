import type { CreateColumnProps } from "shared/types/fact-table";
import type {
  SDKAttribute,
  SDKAttributeSchema,
  SDKAttributeType,
} from "shared/types/organization";
import {
  attributeMatchesDatasourceProjects,
  getEventForwarderManagedIdentifierSourceAttribute,
} from "./event-forwarder-datasource";
import {
  resolveBigQueryEventForwarderTableNames,
  resolveSnowflakeEventForwarderTableNames,
} from "./event-forwarder-destination";

/** BigQuery daily partition column for BigQueryStorageSink (timestamp-millis). */
export const EVENT_FORWARDER_AVRO_PARTITION_FIELD = "received_at" as const;

/** Map field holding org targeting attributes in the forwarder Avro schema. */
export const EVENT_FORWARDER_AVRO_ATTRIBUTES_FIELD = "attributes" as const;

/**
 * Sanitizes a string for use as an Avro/BigQuery/Snowflake field name.
 *
 * IMPORTANT: This logic is intentionally duplicated in
 * central-license-server `eventForwarderAvro.sanitizeAvroFieldName` and
 * growthbook-ingestor `data.sanitizeAvroFieldName`. These repos cannot share
 * code directly. If you change this function, you MUST apply the same change
 * there, and vice versa.
 */
export function sanitizeEventForwarderAvroFieldName(property: string): string {
  const sanitized = property.replace(/[^A-Za-z0-9_]+/g, "_");
  const withPrefix = /^[A-Za-z_]/.test(sanitized) ? sanitized : `_${sanitized}`;
  return withPrefix.slice(0, 255);
}

/**
 * Maps SDK attribute property names to keys used in the forwarder `attributes`
 * map after ingestor promotion/enrichment. Enriched/promoted keys are listed
 * first; SDK keys are fallbacks for COALESCE in warehouse SQL.
 *
 * Keep aligned with growthbook-ingestor `buildForwarderAttributeEntries` and
 * sdk-js `growthbook-tracking` / `auto-attributes` plugins.
 */
const EVENT_FORWARDER_ATTRIBUTE_LOOKUP_KEYS: Record<string, string[]> = {
  utmsource: ["utm_source"],
  utmmedium: ["utm_medium"],
  utmcampaign: ["utm_campaign"],
  utmterm: ["utm_term"],
  utmcontent: ["utm_content"],
  pagetitle: ["page_title"],
  browser: ["ua_browser", "browser"],
  devicetype: ["ua_device_type", "deviceType"],
  path: ["url_path", "path"],
  host: ["url_host", "host"],
  // url_query is JSON-encoded; query is the raw querystring from the SDK.
  query: ["url_query", "query"],
};

/**
 * Returns ordered keys to read inside the `attributes` map for a given SDK
 * attribute property. Enriched/promoted keys come first; SDK keys are
 * fallbacks when multiple keys are returned.
 */
export function resolveEventForwarderAttributeLookupKeys(
  property: string,
): string[] {
  const mapped = EVENT_FORWARDER_ATTRIBUTE_LOOKUP_KEYS[property.toLowerCase()];
  if (mapped) {
    return mapped;
  }

  return [sanitizeEventForwarderAvroFieldName(property)];
}

/**
 * EVENT_FORWARDER_WAREHOUSE_SYNC_DELAY — delay after connector ready or
 * attribute metadata changes before refreshing fact table columns. Increase
 * here if warehouse tables need longer to materialize (currently 1 min).
 */
export const EVENT_FORWARDER_WAREHOUSE_SYNC_DELAY_MS = 1 * 60 * 1000;

export const EVENT_FORWARDER_EVENTS_FACT_TABLE_ID_SUFFIX = "_events";
export const EVENT_FORWARDER_EVENTS_FACT_TABLE_NAME_SUFFIX = " Events";

export function getEventForwarderEventsFactTableId(
  datasourceId: string,
): string {
  return `${datasourceId}${EVENT_FORWARDER_EVENTS_FACT_TABLE_ID_SUFFIX}`;
}

export function getEventForwarderEventsFactTableName(
  datasourceName: string,
): string {
  return `${datasourceName.trim()}${EVENT_FORWARDER_EVENTS_FACT_TABLE_NAME_SUFFIX}`;
}

export function isEventForwarderEventsFactTable(
  factTable: { id: string; managedBy?: string },
  datasourceId: string,
): boolean {
  return (
    factTable.managedBy === "api" &&
    factTable.id === getEventForwarderEventsFactTableId(datasourceId)
  );
}

export function buildBigQueryEventForwarderTableReference(
  projectId: string,
  dataset: string,
  tableName: string,
): string {
  return [projectId, dataset, tableName]
    .map((identifier) => quoteBigQueryIdentifier(identifier.trim()))
    .join(".");
}

export function buildSnowflakeEventForwarderTableReference(
  database: string,
  schema: string,
  tableName: string,
): string {
  return `${database.trim()}.${schema.trim()}.${tableName.trim()}`;
}

export function quoteBigQueryIdentifier(identifier: string): string {
  return `\`${identifier}\``;
}

function quoteSnowflakeVariantFieldName(fieldName: string): string {
  return `"${fieldName.replace(/"/g, '""')}"`;
}

/** Warehouse value type used when casting flat map<string, string> entries. */
export type EventForwarderAttributeValueDatatype =
  | "string"
  | "number"
  | "boolean"
  | "json";

function sdkAttributeTypeToValueDatatype(
  attributeDatatype?: SDKAttributeType,
): EventForwarderAttributeValueDatatype {
  switch (attributeDatatype) {
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "string[]":
    case "number[]":
    case "secureString[]":
      return "json";
    default:
      return "string";
  }
}

function buildBigQueryFlatMapAttributeValueSql(
  fieldName: string,
  valueDatatype: EventForwarderAttributeValueDatatype,
): string {
  const quotedAttributes = quoteBigQueryIdentifier(
    EVENT_FORWARDER_AVRO_ATTRIBUTES_FIELD,
  );
  const jsonPath = `'$."${fieldName}"'`;

  switch (valueDatatype) {
    case "number":
      return `SAFE_CAST(JSON_VALUE(${quotedAttributes}, ${jsonPath}) AS FLOAT64)`;
    case "boolean":
      return `SAFE_CAST(JSON_VALUE(${quotedAttributes}, ${jsonPath}) AS BOOL)`;
    case "json":
      // JSON_QUERY on a native BigQuery JSON column returns JSON type (not STRING),
      // so the fact table column refresh job will correctly infer the type as "json".
      return `JSON_QUERY(${quotedAttributes}, ${jsonPath})`;
    default:
      return `JSON_VALUE(${quotedAttributes}, ${jsonPath})`;
  }
}

function buildSnowflakeFlatMapAttributeValueSql(
  fieldName: string,
  valueDatatype: EventForwarderAttributeValueDatatype,
): string {
  const attributesCol = EVENT_FORWARDER_AVRO_ATTRIBUTES_FIELD.toUpperCase();
  const quotedField = quoteSnowflakeVariantFieldName(fieldName);
  const raw = `${attributesCol}:${quotedField}`;
  const rawString = `${raw}::STRING`;

  switch (valueDatatype) {
    case "number":
      return `TRY_TO_DOUBLE(${rawString})`;
    case "boolean":
      return `TRY_TO_BOOLEAN(${rawString})`;
    case "json":
      return `TRY_PARSE_JSON(${rawString})`;
    default:
      // Map values are strings in Avro; cast so Snowflake reports VARCHAR not VARIANT.
      return rawString;
  }
}

function shouldCastValueDatatypeToString(
  valueDatatype: EventForwarderAttributeValueDatatype,
): boolean {
  return valueDatatype === "string";
}

function buildSnowflakeFlatMapAttributeValueSqlForKey({
  fieldName,
  valueDatatype,
  castToString,
}: {
  fieldName: string;
  valueDatatype: EventForwarderAttributeValueDatatype;
  castToString: boolean;
}): string {
  const attributesCol = EVENT_FORWARDER_AVRO_ATTRIBUTES_FIELD.toUpperCase();
  const quotedField = quoteSnowflakeVariantFieldName(fieldName);
  if (castToString) {
    return `${attributesCol}:${quotedField}::STRING`;
  }
  return buildSnowflakeFlatMapAttributeValueSql(fieldName, valueDatatype);
}

function coalesceSqlExpressions(expressions: string[]): string {
  if (expressions.length === 1) {
    return expressions[0];
  }
  return `COALESCE(${expressions.join(", ")})`;
}

export function buildEventForwarderNestedAttributeValueSql({
  sinkType,
  attributeName,
  attributeDatatype,
  valueDatatype,
  castToString = false,
}: {
  sinkType: "bigquery" | "snowflake";
  attributeName: string;
  /** SDK attribute datatype (fact tables derive effective casts from this). */
  attributeDatatype?: SDKAttributeType;
  /** Explicit warehouse cast type; overrides attributeDatatype when set. */
  valueDatatype?: EventForwarderAttributeValueDatatype;
  /** Coerce attribute values to string (exposure hash ids). Typed columns skip double-cast. */
  castToString?: boolean;
}): string {
  const lookupKeys = resolveEventForwarderAttributeLookupKeys(attributeName);
  const resolvedValueDatatype =
    valueDatatype ?? sdkAttributeTypeToValueDatatype(attributeDatatype);

  if (sinkType === "bigquery") {
    const valueSql = coalesceSqlExpressions(
      lookupKeys.map((fieldName) =>
        buildBigQueryFlatMapAttributeValueSql(fieldName, resolvedValueDatatype),
      ),
    );
    if (
      castToString &&
      shouldCastValueDatatypeToString(resolvedValueDatatype)
    ) {
      return `CAST(${valueSql} AS STRING)`;
    }
    return valueSql;
  }

  return coalesceSqlExpressions(
    lookupKeys.map((fieldName) =>
      buildSnowflakeFlatMapAttributeValueSqlForKey({
        fieldName,
        valueDatatype: resolvedValueDatatype,
        castToString,
      }),
    ),
  );
}

function getEventForwarderEventsFactTableAttributes(
  attributeSchema: SDKAttributeSchema = [],
  datasourceProjects?: string[],
): SDKAttribute[] {
  const seen = new Set<string>();
  const attributes: SDKAttribute[] = [];

  for (const attribute of attributeSchema) {
    if (
      attribute.archived ||
      !attributeMatchesDatasourceProjects(attribute, datasourceProjects)
    ) {
      continue;
    }

    const fieldName = sanitizeEventForwarderAvroFieldName(attribute.property);
    const key = fieldName.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    attributes.push(attribute);
  }

  return attributes;
}

function findEventForwarderEventsFactTableAttribute(
  attributes: SDKAttribute[],
  property: string,
): SDKAttribute | undefined {
  const fieldName = sanitizeEventForwarderAvroFieldName(property).toLowerCase();
  return attributes.find(
    (attribute) =>
      sanitizeEventForwarderAvroFieldName(attribute.property).toLowerCase() ===
      fieldName,
  );
}

function buildEventForwarderEventsFactTableSelect({
  sinkType,
  attributeSchema,
  datasourceProjects,
  userIdTypes = [],
}: {
  sinkType: "bigquery" | "snowflake";
  attributeSchema?: SDKAttributeSchema;
  datasourceProjects?: string[];
  userIdTypes?: string[];
}): string {
  const baseColumns =
    sinkType === "bigquery"
      ? ["  timestamp", "  event_name"]
      : ["  TIMESTAMP AS timestamp", "  EVENT_NAME AS event_name"];
  const attributes = getEventForwarderEventsFactTableAttributes(
    attributeSchema,
    datasourceProjects,
  );

  const projectedFieldKeys = new Set<string>();
  const attributeColumns: string[] = [];

  for (const userIdType of userIdTypes) {
    // The projected column (alias / join key) keeps the managed identifier id
    // (e.g. "ef_user_id"), but the value is extracted from the real source
    // attribute ("user_id"). Non-managed identifier types resolve to themselves.
    const fieldName = sanitizeEventForwarderAvroFieldName(userIdType);
    const key = fieldName.toLowerCase();
    if (projectedFieldKeys.has(key)) {
      continue;
    }
    projectedFieldKeys.add(key);
    const sourceAttribute =
      getEventForwarderManagedIdentifierSourceAttribute(userIdType);
    const matchingAttribute = findEventForwarderEventsFactTableAttribute(
      attributes,
      sourceAttribute,
    );
    const valueSql = buildEventForwarderNestedAttributeValueSql({
      sinkType,
      attributeName: matchingAttribute?.property ?? sourceAttribute,
      valueDatatype: matchingAttribute
        ? getEventForwarderFactTableColumnDatatype(matchingAttribute)
        : "string",
      castToString: !matchingAttribute,
    });
    attributeColumns.push(`  ${valueSql} AS ${fieldName}`);
  }

  for (const attribute of attributes) {
    const fieldName = sanitizeEventForwarderAvroFieldName(attribute.property);
    const key = fieldName.toLowerCase();
    if (projectedFieldKeys.has(key)) {
      continue;
    }
    projectedFieldKeys.add(key);

    const valueDatatype = getEventForwarderFactTableColumnDatatype(attribute);
    const valueSql = buildEventForwarderNestedAttributeValueSql({
      sinkType,
      attributeName: attribute.property,
      valueDatatype,
    });
    attributeColumns.push(`  ${valueSql} AS ${fieldName}`);
  }

  if (attributeColumns.length === 0) {
    return `SELECT\n${baseColumns.join(",\n")}`;
  }

  return `SELECT\n${baseColumns.join(",\n")},\n  -- Attributes\n${attributeColumns.join(",\n")}`;
}

export type BuildEventForwarderEventsFactTableSqlParams =
  | {
      sinkType: "bigquery";
      projectId: string;
      dataset: string;
      tablePrefix: string;
      attributeSchema?: SDKAttributeSchema;
      datasourceProjects?: string[];
      userIdTypes?: string[];
    }
  | {
      sinkType: "snowflake";
      database: string;
      schema: string;
      tablePrefix: string;
      attributeSchema?: SDKAttributeSchema;
      datasourceProjects?: string[];
      userIdTypes?: string[];
    };

export function buildEventForwarderEventsFactTableSql(
  params: BuildEventForwarderEventsFactTableSqlParams,
): string {
  const partitionFilter = `${EVENT_FORWARDER_AVRO_PARTITION_FIELD} BETWEEN '{{startDate}}' AND '{{endDate}}'`;

  if (params.sinkType === "bigquery") {
    const tableNames = resolveBigQueryEventForwarderTableNames(
      params.tablePrefix,
    );
    const tableRef = buildBigQueryEventForwarderTableReference(
      params.projectId,
      params.dataset,
      tableNames.events,
    );
    const select = buildEventForwarderEventsFactTableSelect(params);
    return `${select}\nFROM ${tableRef}\nWHERE ${partitionFilter}`;
  }

  const tableNames = resolveSnowflakeEventForwarderTableNames(
    params.tablePrefix,
  );
  const tableRef = buildSnowflakeEventForwarderTableReference(
    params.database,
    params.schema,
    tableNames.events,
  );
  const select = buildEventForwarderEventsFactTableSelect(params);

  return `${select}\nFROM ${tableRef}`;
}

function getEventForwarderFactTableColumnDatatype(
  attribute: SDKAttribute,
): EventForwarderAttributeValueDatatype {
  return sdkAttributeTypeToValueDatatype(attribute.datatype);
}

export function buildEventForwarderEventsFactTableColumns(
  userIdTypes: string[],
  attributeSchema: SDKAttributeSchema = [],
  datasourceProjects?: string[],
): CreateColumnProps[] {
  if (userIdTypes.length === 0 && attributeSchema.length === 0) {
    return [];
  }

  const seen = new Set<string>();
  const jsonFields: CreateColumnProps["jsonFields"] = {};
  const attributes = getEventForwarderEventsFactTableAttributes(
    attributeSchema,
    datasourceProjects,
  );

  for (const attribute of attributes) {
    const fieldName = sanitizeEventForwarderAvroFieldName(attribute.property);
    const key = fieldName.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    jsonFields[fieldName] = {
      datatype: getEventForwarderFactTableColumnDatatype(attribute),
    };
  }

  for (const userIdType of userIdTypes) {
    const fieldName = sanitizeEventForwarderAvroFieldName(userIdType);
    const key = fieldName.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    // Keep the column datatype aligned with the SELECT: a managed identifier id
    // (e.g. "ef_user_id") inherits the datatype of its source attribute.
    const sourceAttribute =
      getEventForwarderManagedIdentifierSourceAttribute(userIdType);
    const matchingAttribute = findEventForwarderEventsFactTableAttribute(
      attributes,
      sourceAttribute,
    );
    jsonFields[fieldName] = {
      datatype: matchingAttribute
        ? getEventForwarderFactTableColumnDatatype(matchingAttribute)
        : "string",
    };
  }

  return [
    {
      column: EVENT_FORWARDER_AVRO_ATTRIBUTES_FIELD,
      name: EVENT_FORWARDER_AVRO_ATTRIBUTES_FIELD,
      description: "",
      numberFormat: "",
      datatype: "json",
      jsonFields,
    },
  ];
}
