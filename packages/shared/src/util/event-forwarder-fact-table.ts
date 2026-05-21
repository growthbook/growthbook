import type { SDKAttributeSchema } from "shared/types/organization";
import type {
  CreateColumnProps,
  FactTableColumnType,
} from "shared/types/fact-table";
import {
  EVENT_FORWARDER_AVRO_DEFAULT_FIELDS,
  EVENT_FORWARDER_AVRO_PARTITION_FIELD,
  sanitizeAvroFieldName,
} from "../event-forwarder-avro";
import { attributeMatchesDatasourceProjects } from "./datasource";

export { EVENT_FORWARDER_AVRO_PARTITION_FIELD };

export const EVENT_FORWARDER_EVENTS_FACT_TABLE_ID_SUFFIX = "_events";
export const EVENT_FORWARDER_EVENTS_FACT_TABLE_NAME_SUFFIX = " Events";

const DEFAULT_FIELD_NAMES: Set<string> = new Set(
  EVENT_FORWARDER_AVRO_DEFAULT_FIELDS.map((f) => f.name),
);

export function sanitizeDatasourceNameForFactTableId(name: string): string {
  const sanitized = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");

  if (!sanitized) {
    return "datasource";
  }

  if (!/^[a-z_]/.test(sanitized)) {
    return `_${sanitized}`;
  }

  return sanitized;
}

export function getEventForwarderEventsFactTableId(
  datasourceName: string,
): string {
  return `${sanitizeDatasourceNameForFactTableId(datasourceName)}${EVENT_FORWARDER_EVENTS_FACT_TABLE_ID_SUFFIX}`;
}

export function getEventForwarderEventsFactTableIdWithCollisionSuffix(
  datasourceName: string,
  datasourceId: string,
): string {
  const prefix = sanitizeDatasourceNameForFactTableId(datasourceName);
  const idSuffix = datasourceId
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(-6)
    .toLowerCase();
  if (!idSuffix) {
    return `${prefix}${EVENT_FORWARDER_EVENTS_FACT_TABLE_ID_SUFFIX}`;
  }
  return `${prefix}_${idSuffix}${EVENT_FORWARDER_EVENTS_FACT_TABLE_ID_SUFFIX}`;
}

export function getEventForwarderEventsFactTableName(
  datasourceName: string,
): string {
  return `${datasourceName.trim()}${EVENT_FORWARDER_EVENTS_FACT_TABLE_NAME_SUFFIX}`;
}

export function isEventForwarderEventsFactTableCandidate(
  factTable: { id: string; name: string; managedBy?: string },
  datasourceName: string,
): boolean {
  if (factTable.managedBy !== "api") {
    return false;
  }

  const expectedName = getEventForwarderEventsFactTableName(datasourceName);
  if (factTable.name === expectedName) {
    return true;
  }

  const prefix = sanitizeDatasourceNameForFactTableId(datasourceName);
  return (
    factTable.id === getEventForwarderEventsFactTableId(datasourceName) ||
    (factTable.id.startsWith(`${prefix}_`) &&
      factTable.id.endsWith(EVENT_FORWARDER_EVENTS_FACT_TABLE_ID_SUFFIX))
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

export type BuildEventForwarderEventsFactTableSqlParams =
  | {
      sinkType: "bigquery";
      projectId: string;
      dataset: string;
      tableName: string;
    }
  | {
      sinkType: "snowflake";
      database: string;
      schema: string;
      tableName: string;
      userIdTypes: string[];
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
    return `SELECT *\nFROM ${tableRef}\nWHERE ${partitionFilter}`;
  }

  const tableRef = buildSnowflakeEventForwarderTableReference(
    params.database,
    params.schema,
    params.tableName,
  );

  const standardCols = [
    ...params.userIdTypes,
    "event_name",
    "timestamp",
    EVENT_FORWARDER_AVRO_PARTITION_FIELD,
  ];
  const selectCols = standardCols.map((col) => `${col}`).join(",\n  ");

  return `SELECT\n  ${selectCols}\nFROM\n  ${tableRef}\nWHERE ${partitionFilter}`;
}

function defaultAvroFieldDatatype(fieldName: string): FactTableColumnType {
  if (
    fieldName === "timestamp" ||
    fieldName === EVENT_FORWARDER_AVRO_PARTITION_FIELD
  ) {
    return "date";
  }
  if (fieldName === "properties" || fieldName === "additional_attributes") {
    return "json";
  }
  if (fieldName === "geo_lat" || fieldName === "geo_lon") {
    return "number";
  }
  return "string";
}

function hashAttributeDatatype(datatype: string): FactTableColumnType {
  if (datatype === "number" || datatype === "number[]") {
    return "number";
  }
  if (datatype === "boolean") {
    return "boolean";
  }
  return "string";
}

export function buildEventForwarderEventsFactTableColumns(
  userIdTypes: string[],
  attributeSchema: SDKAttributeSchema = [],
  datasourceProjects?: string[],
): CreateColumnProps[] {
  const columns: CreateColumnProps[] = [];
  const seen = new Set<string>();

  const pushColumn = (column: CreateColumnProps) => {
    const key = column.column.toLowerCase();
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    columns.push({
      ...column,
      name: column.name ?? column.column,
      description: column.description ?? "",
      numberFormat: column.numberFormat ?? "",
    });
  };

  for (const userIdType of userIdTypes) {
    pushColumn({
      column: userIdType,
      datatype: "string",
    });
  }

  for (const field of EVENT_FORWARDER_AVRO_DEFAULT_FIELDS) {
    pushColumn({
      column: field.name,
      datatype: defaultAvroFieldDatatype(field.name),
      alwaysInlineFilter: field.name === "event_name" ? true : undefined,
    });
  }

  for (const attr of attributeSchema) {
    if (!attr.hashAttribute || attr.archived) {
      continue;
    }
    if (!attributeMatchesDatasourceProjects(attr, datasourceProjects)) {
      continue;
    }

    const column = sanitizeAvroFieldName(attr.property);
    if (DEFAULT_FIELD_NAMES.has(column)) {
      continue;
    }

    pushColumn({
      column,
      datatype: hashAttributeDatatype(attr.datatype),
      description: attr.description ?? "",
    });
  }

  return columns;
}
