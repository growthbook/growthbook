import { EVENT_FORWARDER_AVRO_PARTITION_FIELD } from "./event-forwarder-fact-table";

/** Canonical result column names for experiment_viewed (excluding dynamic userIdType). */
export const EVENT_FORWARDER_EXPERIMENT_VIEWED_PROBE_COLUMNS = [
  "experiment_id",
  "variation_id",
  "timestamp",
] as const;

/** Canonical result column names for feature_usage. */
export const EVENT_FORWARDER_FEATURE_USAGE_PROBE_COLUMNS = [
  "timestamp",
  "feature_key",
] as const;

export type EventForwarderWarehouseSinkType = "bigquery" | "snowflake";

/**
 * Warehouse-native identifier for SELECT (quoted/backticked for BigQuery,
 * uppercased for Snowflake unquoted identifiers).
 */
export function eventForwarderWarehouseSourceColumn(
  sinkType: EventForwarderWarehouseSinkType,
  column: string,
): string {
  if (sinkType === "snowflake") {
    return column.toUpperCase();
  }
  return `\`${column}\``;
}

/**
 * Alias in the SELECT list so runTestQuery column metadata matches the canonical
 * names used by testQueryValidity / testFeatureUsageQueryValidity.
 */
export function eventForwarderWarehouseResultColumnAlias(
  sinkType: EventForwarderWarehouseSinkType,
  column: string,
): string {
  if (sinkType === "bigquery") {
    return `\`${column}\``;
  }
  return column;
}

/**
 * Builds a column-probe query for Event Forwarder warehouse tables. Mirrors
 * managed exposure / feature-usage queries: source identifiers follow warehouse
 * rules, aliases normalize result column names across BigQuery and Snowflake.
 */
export function buildEventForwarderColumnProbeSql({
  sinkType,
  tableRef,
  columnNames,
  partitionFilter = false,
}: {
  sinkType: EventForwarderWarehouseSinkType;
  tableRef: string;
  columnNames: string[];
  partitionFilter?: boolean;
}): string {
  if (columnNames.length === 0) {
    throw new Error(
      "Event forwarder column probe requires at least one column",
    );
  }

  const selects = columnNames.map((column) => {
    const source = eventForwarderWarehouseSourceColumn(sinkType, column);
    const alias = eventForwarderWarehouseResultColumnAlias(sinkType, column);
    return `${source} AS ${alias}`;
  });

  let sql = `SELECT\n  ${selects.join(",\n  ")}\nFROM ${tableRef}`;

  if (partitionFilter && sinkType === "bigquery") {
    sql += `\nWHERE ${EVENT_FORWARDER_AVRO_PARTITION_FIELD} BETWEEN '{{startDate}}' AND '{{endDate}}'`;
  }

  return sql;
}
