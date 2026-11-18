import { deflateSync, inflateSync, strFromU8, strToU8 } from "fflate";
import type { FactTableColumnType } from "shared/types/fact-table";
import type {
  ExplorationConfig,
  ExplorationDataset,
} from "../../../validators/product-analytics";

/**
 * Narrows an already-classified warehouse column type to the smaller set an
 * exploration dataset can hold. `json`, `binary` and the undetected `""` have
 * no exploration equivalent.
 */
export function mapColumnTypeToExplorationType(
  datatype: FactTableColumnType | undefined,
): "string" | "number" | "date" | "boolean" | "other" {
  switch (datatype) {
    case "string":
    case "number":
    case "date":
    case "boolean":
      return datatype;
    case "json":
    case "binary":
    case "other":
    case "":
    case undefined:
      return "other";
  }
}

// Checked first, since inner types like `ARRAY<INT64>` would match a primitive
const COMPLEX_TYPE =
  /^(struct|array|map|jsonb?|variant|object|tuple|row|record|super|nested|vector|range)\b/;

export function mapDatabaseTypeToEnum(
  dbType: string,
): "string" | "number" | "date" | "boolean" | "other" {
  const lowerType = dbType.toLowerCase();

  // ClickHouse wraps the real type, as in `LowCardinality(Nullable(String))`
  if (
    COMPLEX_TYPE.test(lowerType.replace(/^((nullable|lowcardinality)\()+/, ""))
  ) {
    return "other";
  }

  if (
    lowerType.includes("int") ||
    // Snowflake and Oracle report every fixed-point column as NUMBER
    lowerType.includes("number") ||
    lowerType.includes("numeric") ||
    lowerType.includes("decimal") ||
    lowerType.includes("float") ||
    lowerType.includes("double") ||
    lowerType.includes("real")
  ) {
    return "number";
  }

  if (lowerType.includes("date") || lowerType.includes("time")) {
    return "date";
  }

  if (lowerType.includes("bool")) {
    return "boolean";
  }

  if (
    lowerType.includes("char") ||
    lowerType.includes("text") ||
    lowerType.includes("string")
  ) {
    return "string";
  }

  return "other";
}

/** True when a dataset timestamp field names a real column. Empty string, null, and undefined are all "unset". */
export function hasTimestampColumn(
  timestampColumn: string | null | undefined,
): timestampColumn is string {
  return typeof timestampColumn === "string" && timestampColumn.length > 0;
}

/**
 * SQL and data_source datasets can omit a timestamp (SQL on purpose; data_source
 * while the user is still picking a column). Other dataset types always have one.
 */
export function hasTimeAxis(
  dataset: Pick<ExplorationDataset, "type"> & {
    timestampColumn?: string | null;
  },
): boolean {
  if (dataset.type === "sql" || dataset.type === "data_source") {
    return hasTimestampColumn(dataset.timestampColumn);
  }
  return true;
}

/** Default product analytics config used for new blocks and Explorer initial state. */
export const DEFAULT_EXPLORE_STATE: ExplorationConfig = {
  type: "metric",
  dataset: {
    type: "metric",
    values: [],
  },
  datasource: "",
  dimensions: [
    {
      dimensionType: "date",
      column: "date",
      dateGranularity: "auto",
    },
  ],
  chartType: "line",
  dateRange: {
    predefined: "last30Days",
    lookbackValue: 30,
    lookbackUnit: "day",
    startDate: null,
    endDate: null,
  },
};

export type ProductAnalyticsExplorationBlockType =
  | "metric-exploration"
  | "fact-table-exploration"
  | "data-source-exploration"
  | "sql-exploration"
  | "funnel-exploration";

export function getInitialConfigByBlockType(
  blockType: ProductAnalyticsExplorationBlockType,
  datasourceId: string,
): ExplorationConfig {
  switch (blockType) {
    case "metric-exploration":
      return {
        ...DEFAULT_EXPLORE_STATE,
        datasource: datasourceId,
      };
    case "fact-table-exploration":
      return {
        ...DEFAULT_EXPLORE_STATE,
        type: "fact_table",
        dataset: {
          type: "fact_table",
          values: [],
          factTableId: null,
        },
        datasource: datasourceId,
      };
    case "data-source-exploration":
      return {
        ...DEFAULT_EXPLORE_STATE,
        type: "data_source",
        dataset: {
          type: "data_source",
          values: [],
          table: "",
          path: "",
          timestampColumn: "",
          columnTypes: {},
        },
        datasource: datasourceId,
      };
    case "sql-exploration":
      return {
        ...DEFAULT_EXPLORE_STATE,
        type: "sql",
        dimensions: [],
        chartType: "bar",
        dataset: {
          type: "sql",
          values: [],
          sql: "",
          timestampColumn: null,
          columnTypes: {},
        },
        datasource: datasourceId,
      };
    case "funnel-exploration":
      return {
        ...DEFAULT_EXPLORE_STATE,
        type: "funnel",
        dataset: {
          type: "funnel",
          unit: null,
          steps: [],
        },
        datasource: datasourceId,
      };
    default:
      throw new Error(`Invalid block type: ${blockType}`);
  }
}

// `~` is not in either base64 alphabet, so its presence unambiguously marks the
// compressed format and lets us keep decoding links shared before it existed.
// It is also unreserved in a URL, so it survives without percent-encoding.
const COMPRESSED_CONFIG_PREFIX = "~";
const MAX_ENCODED_CONFIG_LENGTH = 16 * 1024;
const MAX_DECODED_CONFIG_BYTES = 100 * 1024;

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  // Chunked because String.fromCharCode(...bytes) overflows the call stack on
  // the payload sizes that made this compression necessary.
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64UrlToBytes(encoded: string): Uint8Array {
  const binary = atob(encoded.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function encodeExplorationConfig(config: ExplorationConfig): string {
  const deflated = deflateSync(strToU8(JSON.stringify(config)), { level: 9 });
  return COMPRESSED_CONFIG_PREFIX + bytesToBase64Url(deflated);
}

function inflateExplorationConfig(deflated: Uint8Array): Uint8Array {
  // Streaming Inflate still grows an internal buffer before ondata; `out` is
  // what caps allocation.
  const out = new Uint8Array(MAX_DECODED_CONFIG_BYTES + 1);
  const inflated = inflateSync(deflated, { out });
  if (inflated.length > MAX_DECODED_CONFIG_BYTES) {
    throw new Error("Exploration config is too large");
  }
  return inflated;
}

/**
 * Parses an encoded `?config=` payload into untrusted JSON. Callers validate the
 * result. Throws on a malformed payload.
 */
export function decodeExplorationConfigJson(encoded: string): unknown {
  if (encoded.length > MAX_ENCODED_CONFIG_LENGTH) {
    throw new Error("Exploration config is too large");
  }
  if (encoded.startsWith(COMPRESSED_CONFIG_PREFIX)) {
    const deflated = base64UrlToBytes(
      encoded.slice(COMPRESSED_CONFIG_PREFIX.length),
    );
    return JSON.parse(strFromU8(inflateExplorationConfig(deflated)));
  }
  const json = decodeURIComponent(atob(encoded));
  if (json.length > MAX_DECODED_CONFIG_BYTES) {
    throw new Error("Exploration config is too large");
  }
  return JSON.parse(json);
}

// Classifies a metric for chart-mixing rules.
// - "ratio"    -> always renders as N/D, can't be mixed with other classes
// - "quantile" -> percentile value, can't be mixed with other classes
// - "standard" -> mean/proportion/retention/dailyParticipation, mix freely
// - "unknown"  -> unselected metric or metric id we couldn't resolve
export type MetricMixClass = "ratio" | "quantile" | "standard" | "unknown";

export function getMetricMixClass(
  metricType: string | null | undefined,
): MetricMixClass {
  if (metricType === "ratio") return "ratio";
  if (metricType === "quantile") return "quantile";
  if (
    metricType === "mean" ||
    metricType === "proportion" ||
    metricType === "retention" ||
    metricType === "dailyParticipation"
  ) {
    return "standard";
  }
  return "unknown";
}

export * from "./show-as";
export * from "./units";
export * from "./cached-display";
export * from "./result-presentation";
