import type { DataType } from "shared/types/integrations";
import type { DateTruncGranularity, SqlDialect } from "shared/types/sql";
import { defaultPercentileCapSelectClause } from "back-end/src/integrations/sql/clauses/percentile-cap-select-clause";

export const baseDialect: Omit<SqlDialect, "unpivotLabeledPairs"> = {
  escapeStringLiteral: (value: string) => value.replace(/'/g, `''`),

  jsonExtract: (jsonCol: string, path: string, isNumeric: boolean) => {
    const raw = `json_extract_scalar(${jsonCol}, '$.${path}')`;
    return isNumeric ? baseDialect.castToFloat(raw) : raw;
  },

  evalBoolean: (col: string, value: boolean) =>
    `${col} IS ${value ? "TRUE" : "FALSE"}`,

  dateTrunc: (col: string, granularity: DateTruncGranularity = "day") =>
    `date_trunc('${granularity}', ${col})`,

  dateDiff: (startCol: string, endCol: string) =>
    `datediff(day, ${startCol}, ${endCol})`,

  dateDiffMs: (startCol: string, endCol: string) =>
    `(EXTRACT(EPOCH FROM (${endCol} - ${startCol})) * 1000)`,

  addIntervalSeconds: (col: string, sign: "+" | "-", amount: number) =>
    `${col} ${sign} INTERVAL '${amount} seconds'`,

  percentileApprox: (column: string, percentile: number | string) =>
    `APPROX_PERCENTILE(${column}, ${percentile})`,

  toTimestamp: (date: Date) =>
    `'${date.toISOString().substr(0, 19).replace("T", " ")}'`,

  // Important: If overriding `castToFloat` in a dialect, you must also override
  // `jsonExtract` since it references this method
  castToFloat: (col: string) => col,

  castToString: (col: string) => `cast(${col} as varchar)`,

  castToDate: (col: string) => `CAST(${col} AS DATE)`,

  castToTimestamp: (col: string) => `CAST(${col} AS TIMESTAMP)`,

  castUserDateCol: (column: string) => column,

  // Postgres-flavored array helpers. Redshift inherits these unchanged.
  // BigQuery/Snowflake/Athena/ClickHouse have their own array syntax and
  // override below; if a dialect doesn't support arrays at all (MySQL,
  // older MSSQL) it'll need to override these to throw or to express the
  // operation through a different mechanism (e.g. JSON_TABLE).
  arrayAggSorted: (col: string) =>
    `ARRAY_AGG(${col} ORDER BY ${col}) FILTER (WHERE ${col} IS NOT NULL)`,

  argMinByTimestamp: (valueCol: string, tsCol: string) =>
    // No standard ARG_MIN in Postgres. Trick: build a value-array ordered
    // by the timestamp column (NULLs filtered), then index [1] gives the
    // value paired with the earliest timestamp.
    `(ARRAY_AGG(${valueCol} ORDER BY ${tsCol}) FILTER (WHERE ${tsCol} IS NOT NULL))[1]`,

  arrayMinInRange: (col, lowerBound, upperBound) => {
    const conditions: string[] = [];
    if (lowerBound) conditions.push(`t >= ${lowerBound}`);
    if (upperBound) conditions.push(`t <= ${upperBound}`);
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    return `(SELECT MIN(t) FROM unnest(${col}) AS t ${where})`;
  },

  getCurrentTimestamp: () => `CURRENT_TIMESTAMP`,

  ifElse: (condition: string, ifTrue: string, ifFalse: string) =>
    `(CASE WHEN ${condition} THEN ${ifTrue} ELSE ${ifFalse} END)`,

  getDataType: (dataType: DataType): string => {
    switch (dataType) {
      case "string":
        return "VARCHAR";
      case "integer":
        return "INTEGER";
      case "float":
        return "DOUBLE";
      case "boolean":
        return "BOOLEAN";
      case "date":
        return "DATE";
      case "timestamp":
        return "TIMESTAMP";
      case "hll":
        return "VARBINARY";
      case "kll":
        return "VARBINARY";
      default: {
        const _: never = dataType;
        throw new Error(`Unsupported data type: ${dataType}`);
      }
    }
  },

  addTime: (
    col: string,
    unit: "hour" | "minute",
    sign: "+" | "-",
    amount: number,
  ) => `${col} ${sign} INTERVAL '${amount} ${unit}s'`,

  formatDate: (col: string) => col,

  formatDateTimeString: (col: string) => baseDialect.castToString(col),

  selectStarLimit: (
    from: string,
    limit: number,
    additionalClauses: string = "",
  ) => `SELECT * FROM ${from} ${additionalClauses} LIMIT ${limit}`,

  defaultSchema: "",

  formatDialect: "",

  percentileCapSelectClause: (values, metricTable, where = "") =>
    defaultPercentileCapSelectClause(baseDialect, values, metricTable, where),

  hasCountDistinctHLL: () => false,

  hllAggregate: () => {
    throw new Error(
      "COUNT DISTINCT is not supported for fact metrics in this data source.",
    );
  },

  hllReaggregate: () => {
    throw new Error(
      "COUNT DISTINCT is not supported for fact metrics in this data source.",
    );
  },

  hllCardinality: () => {
    throw new Error(
      "COUNT DISTINCT is not supported for fact metrics in this data source.",
    );
  },

  kllInit: () => {
    throw new Error(
      "KLL quantile sketches are not supported by this data source.",
    );
  },

  kllMergePartial: () => {
    throw new Error(
      "KLL quantile sketches are not supported by this data source.",
    );
  },

  kllExtractPoint: () => {
    throw new Error(
      "KLL quantile sketches are not supported by this data source.",
    );
  },

  kllExtractQuantiles: () => {
    throw new Error(
      "KLL quantile sketches are not supported by this data source.",
    );
  },

  kllRankApprox: () => {
    throw new Error(
      "KLL rank approximation is not implemented for this data source.",
    );
  },

  stringLength: (column: string) => `LENGTH(${column})`,
};
