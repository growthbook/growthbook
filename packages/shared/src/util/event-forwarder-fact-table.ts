import type { CreateColumnProps } from "shared/types/fact-table";
import type {
  SDKAttribute,
  SDKAttributeSchema,
  SDKAttributeType,
} from "shared/types/organization";
import { attributeMatchesDatasourceProjects } from "./datasource";

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
  return `\`${projectId.trim()}\`.\`${dataset.trim()}\`.\`${tableName.trim()}\``;
}

export function buildSnowflakeEventForwarderTableReference(
  database: string,
  schema: string,
  tableName: string,
): string {
  return `${database.trim()}.${schema.trim()}.${tableName.trim()}`;
}

function quoteBigQueryIdentifier(identifier: string): string {
  return `\`${identifier}\``;
}

function quoteSnowflakeVariantFieldName(fieldName: string): string {
  return `"${fieldName.replace(/"/g, '""')}"`;
}

function quoteBigQueryJsonPathField(fieldName: string): string {
  return fieldName.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function buildBigQueryJsonAttributeValueSql(
  fieldName: string,
  attributeDatatype?: SDKAttributeType,
): string {
  const quotedAttributes = quoteBigQueryIdentifier(
    EVENT_FORWARDER_AVRO_ATTRIBUTES_FIELD,
  );
  const jsonPathField = quoteBigQueryJsonPathField(fieldName);
  const jsonValue = `JSON_VALUE(${quotedAttributes}, '$."${jsonPathField}"')`;

  switch (attributeDatatype) {
    case "number":
      return `SAFE_CAST(${jsonValue} AS FLOAT64)`;
    case "boolean":
      return `SAFE_CAST(${jsonValue} AS BOOL)`;
    case "string[]":
    case "number[]":
    case "secureString[]":
      return `JSON_QUERY(${quotedAttributes}, '$."${jsonPathField}"')`;
    default:
      return jsonValue;
  }
}

export function buildEventForwarderNestedAttributeValueSql({
  sinkType,
  attributeName,
  attributeDatatype,
  castSnowflakeToString = false,
}: {
  sinkType: "bigquery" | "snowflake";
  attributeName: string;
  attributeDatatype?: SDKAttributeType;
  castSnowflakeToString?: boolean;
}): string {
  const fieldName = sanitizeEventForwarderAvroFieldName(attributeName);

  if (sinkType === "bigquery") {
    const valueSql = buildBigQueryJsonAttributeValueSql(
      fieldName,
      attributeDatatype,
    );
    if (castSnowflakeToString) {
      return `CAST(${valueSql} AS STRING)`;
    }
    return valueSql;
  }

  const attributesCol = EVENT_FORWARDER_AVRO_ATTRIBUTES_FIELD.toUpperCase();
  const quotedField = quoteSnowflakeVariantFieldName(fieldName);
  const valueSql = `${attributesCol}:${quotedField}`;
  return castSnowflakeToString ? `${valueSql}::STRING` : valueSql;
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

function buildEventForwarderEventsFactTableSelect({
  sinkType,
  attributeSchema,
  datasourceProjects,
}: {
  sinkType: "bigquery" | "snowflake";
  attributeSchema?: SDKAttributeSchema;
  datasourceProjects?: string[];
}): string {
  const baseColumns =
    sinkType === "bigquery"
      ? ["  timestamp", "  event_name"]
      : ["  TIMESTAMP AS timestamp", "  EVENT_NAME AS event_name"];
  const attributes = getEventForwarderEventsFactTableAttributes(
    attributeSchema,
    datasourceProjects,
  );

  if (attributes.length === 0) {
    return `SELECT\n${baseColumns.join(",\n")}`;
  }

  const attributeColumns = attributes.map((attribute) => {
    const fieldName = sanitizeEventForwarderAvroFieldName(attribute.property);
    const valueSql = buildEventForwarderNestedAttributeValueSql({
      sinkType,
      attributeName: attribute.property,
      attributeDatatype: attribute.datatype,
    });
    return `  ${valueSql} AS ${fieldName}`;
  });

  return `SELECT\n${baseColumns.join(",\n")},\n  -- Attributes\n${attributeColumns.join(",\n")}`;
}

export type BuildEventForwarderEventsFactTableSqlParams =
  | {
      sinkType: "bigquery";
      projectId: string;
      dataset: string;
      tableName: string;
      attributeSchema?: SDKAttributeSchema;
      datasourceProjects?: string[];
    }
  | {
      sinkType: "snowflake";
      database: string;
      schema: string;
      tableName: string;
      attributeSchema?: SDKAttributeSchema;
      datasourceProjects?: string[];
    };

export function buildEventForwarderEventsFactTableSql(
  params: BuildEventForwarderEventsFactTableSqlParams,
): string {
  const partitionFilter = `${EVENT_FORWARDER_AVRO_PARTITION_FIELD} BETWEEN '{{startDate}}' AND '{{endDate}}'`;

  if (params.sinkType === "bigquery") {
    const tableRef = buildBigQueryEventForwarderTableReference(
      params.projectId,
      params.dataset,
      params.tableName,
    );
    const select = buildEventForwarderEventsFactTableSelect(params);
    return `${select}\nFROM ${tableRef}\nWHERE ${partitionFilter}`;
  }

  const tableRef = buildSnowflakeEventForwarderTableReference(
    params.database,
    params.schema,
    params.tableName,
  );
  const select = buildEventForwarderEventsFactTableSelect(params);

  return `${select}\nFROM ${tableRef}`;
}

function getEventForwarderFactTableColumnDatatype(
  attribute: SDKAttribute,
): CreateColumnProps["datatype"] {
  if (attribute.hashAttribute) {
    return "string";
  }

  switch (attribute.datatype) {
    case "boolean":
      return "boolean";
    case "number":
      return "number";
    case "string[]":
    case "number[]":
    case "secureString[]":
      return "json";
    default:
      return "string";
  }
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

  for (const attribute of getEventForwarderEventsFactTableAttributes(
    attributeSchema,
    datasourceProjects,
  )) {
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
    jsonFields[fieldName] = { datatype: "string" };
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
