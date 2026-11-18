import { FactTableColumnType } from "shared/types/fact-table";
import { QueryMetadata } from "shared/types/query";
import { logger } from "back-end/src/util/logger";

const URL_SCHEME = /^[a-z][a-z\d+.-]*:/i;
const URL_SCHEME_WITH_AUTHORITY = /^[a-z][a-z\d+.-]*:\/\//i;
const HOST_WITH_PORT = /^[^/:]+:\d+(?:\/|$)/;
const TRAILING_SLASHES = /\/+$/;
const BIGQUERY_API_PATH_SUFFIX = /\/bigquery\/v2$/;

export function normalizeBigQueryApiEndpoint(
  apiEndpoint?: unknown,
): string | undefined {
  if (apiEndpoint === undefined) return undefined;
  if (typeof apiEndpoint !== "string") {
    throw new Error("BigQuery API endpoint must be a string.");
  }

  const endpoint = apiEndpoint.trim();
  if (!endpoint) return undefined;

  let url: URL;
  try {
    if (
      endpoint.startsWith("//") ||
      endpoint.includes("\\") ||
      Array.from(endpoint).some(
        (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
      ) ||
      (URL_SCHEME.test(endpoint) &&
        !URL_SCHEME_WITH_AUTHORITY.test(endpoint) &&
        !HOST_WITH_PORT.test(endpoint))
    ) {
      throw new Error();
    }
    url = new URL(
      URL_SCHEME_WITH_AUTHORITY.test(endpoint)
        ? endpoint
        : `https://${endpoint}`,
    );
  } catch {
    throw new Error("BigQuery API endpoint must be a valid HTTP or HTTPS URL.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("BigQuery API endpoint must use HTTP or HTTPS.");
  }
  if (url.username || url.password) {
    throw new Error(
      "BigQuery API endpoint cannot contain embedded credentials.",
    );
  }
  if (endpoint.includes("?") || endpoint.includes("#")) {
    throw new Error(
      "BigQuery API endpoint cannot contain a query string or fragment.",
    );
  }

  // The SDK automatically appends /bigquery/v2 to apiEndpoint
  const path = url.pathname
    .replace(TRAILING_SLASHES, "")
    .replace(BIGQUERY_API_PATH_SUFFIX, "");
  return `${url.origin}${path}`;
}

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
      return "other";

    case "BYTES":
      return "binary";

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
    if (Object.keys(labels).length >= 63) break;
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) continue;
    if (typeof value !== "string") continue;

    const sanitizedKey = sanitizeLabelKey(key);
    const sanitizedValue = sanitizeLabelValue(value);
    labels[sanitizedKey] = sanitizedValue;
  }
  return labels;
}
