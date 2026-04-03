import { FactTableColumnType } from "shared/types/fact-table";
import { QueryMetadata } from "shared/types/query";
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

/**
 * BigQuery label rules:
 * - Max 64 labels per resource
 * - Keys: 1–63 chars, lowercase letters/digits/underscores/dashes, must start
 *   with a lowercase letter or international character
 * - Values: 0–63 chars, lowercase letters/digits/underscores/dashes
 * - No arrays or non-string values
 */
function sanitizeLabelValue(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "_")
    .slice(0, 63);
}

function sanitizeLabelKey(key: string): string {
  let sanitized = key
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "_")
    .slice(0, 63);
  if (!sanitized || !/^[a-z]/.test(sanitized)) {
    sanitized = "l_" + sanitized;
    sanitized = sanitized.slice(0, 63);
  }
  return sanitized;
}

export function sanitizeQueryMetadataForBigQueryLabels(
  queryMetadata?: QueryMetadata,
): Record<string, string> {
  if (!queryMetadata) return {};

  const labels: Record<string, string> = {};
  for (const [key, value] of Object.entries(queryMetadata)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) continue;
    if (typeof value !== "string") continue;

    const sanitizedKey = sanitizeLabelKey(key);
    const sanitizedValue = sanitizeLabelValue(value);
    labels[sanitizedKey] = sanitizedValue;
  }
  return labels;
}
