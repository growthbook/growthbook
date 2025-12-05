import { FactTableColumnType } from "back-end/types/fact-table";
import { logger } from "back-end/src/util/logger";

export type BigQueryDataType =
  | "STRING"
  | "BYTES"
  | "INTEGER"
  | "INT64"
  | "FLOAT"
  | "FLOAT64"
  | "BOOLEAN"
  | "BOOL"
  | "TIMESTAMP"
  | "DATE"
  | "TIME"
  | "DATETIME"
  | "GEOGRAPHY"
  | "NUMERIC"
  | "BIGNUMERIC"
  | "JSON"
  | "RECORD"
  | "STRUCT"
  | "RANGE";

export function getFactTableTypeFromBigQueryType(
  dataType: BigQueryDataType,
): FactTableColumnType | undefined {
  switch (dataType) {
    case "STRING":
      return "string";

    case "BOOL":
    case "BOOLEAN":
      return "boolean";

    case "NUMERIC":
    case "BIGNUMERIC":
    case "INTEGER":
    case "INT64":
    case "FLOAT":
    case "FLOAT64":
      return "number";

    case "DATE":
    case "TIME":
    case "DATETIME":
    case "TIMESTAMP":
      return "date";

    case "JSON":
    case "RECORD":
    case "STRUCT":
      return "json";

    case "RANGE":
    case "GEOGRAPHY":
    case "BYTES":
      return "other";

    default: {
      const _: never = dataType;
      logger.warn(`Unsupported BigQuery data type: ${dataType}`);
      return undefined;
    }
  }
}
