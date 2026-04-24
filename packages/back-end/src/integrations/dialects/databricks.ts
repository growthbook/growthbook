import type { DataType } from "shared/types/integrations";
import type { SqlDialect } from "shared/types/sql";
import { defaultPercentileCapSelectClause } from "back-end/src/integrations/sql/clauses/percentile-cap-select-clause";
import { baseDialect } from "./base";

export const databricksDialect: SqlDialect = {
  ...baseDialect,
  formatDialect: "spark",
  toTimestamp: (date: Date) => `TIMESTAMP'${date.toISOString()}'`,
  addTime: (
    col: string,
    unit: "hour" | "minute",
    sign: "+" | "-",
    amount: number,
  ) => `timestampadd(${unit},${sign === "-" ? "-" : ""}${amount},${col})`,
  formatDate: (col: string) => `date_format(${col}, 'y-MM-dd')`,
  formatDateTimeString: (col: string) =>
    `date_format(${col}, 'y-MM-dd HH:mm:ss.SSS')`,
  castToString: (col: string) => `cast(${col} as string)`,
  castToFloat: (col: string) => `cast(${col} as double)`,
  escapeStringLiteral: (value: string) => value.replace(/(['\\])/g, "\\$1"),
  hasCountDistinctHLL: () => true,
  hllAggregate: (col: string) =>
    `HLL_SKETCH_AGG(${databricksDialect.castToString(col)})`,
  hllReaggregate: (col: string) => `HLL_UNION_AGG(${col})`,
  hllCardinality: (col: string) => `HLL_SKETCH_ESTIMATE(${col})`,
  jsonExtract: (jsonCol: string, path: string, isNumeric: boolean) => {
    const raw = `${jsonCol}:${path}`;
    return isNumeric ? databricksDialect.castToFloat(raw) : raw;
  },
  getDataType: (dataType: DataType): string => {
    switch (dataType) {
      case "string":
        return "STRING";
      case "integer":
        return "INT";
      case "float":
        return "DOUBLE";
      case "boolean":
        return "BOOLEAN";
      case "date":
        return "DATE";
      case "timestamp":
        return "TIMESTAMP";
      case "hll":
        return "BINARY";
      case "kll":
        return "BINARY";
      default: {
        const _: never = dataType;
        throw new Error(`Unsupported data type: ${dataType}`);
      }
    }
  },
  percentileCapSelectClause: (values, metricTable, where = "") =>
    defaultPercentileCapSelectClause(
      databricksDialect,
      values,
      metricTable,
      where,
    ),
};
