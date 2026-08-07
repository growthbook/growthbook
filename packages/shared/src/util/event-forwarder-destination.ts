const BIGQUERY_TABLE_NAME_MAX_LENGTH = 1024;
const SNOWFLAKE_IDENTIFIER_MAX_LENGTH = 255;
const SNOWFLAKE_HOST_SUFFIX = ".snowflakecomputing.com";

export const DEFAULT_EVENT_FORWARDER_TABLE_PREFIX = "gb";
export const EVENT_FORWARDER_EVENTS_TABLE_SUFFIX = "events";
export const EVENT_FORWARDER_EXPERIMENT_VIEWED_TABLE_SUFFIX =
  "experiment_viewed";
export const EVENT_FORWARDER_FEATURE_USAGE_TABLE_SUFFIX = "feature_usage";

const EVENT_FORWARDER_TABLE_SUFFIXES = [
  EVENT_FORWARDER_EVENTS_TABLE_SUFFIX,
  EVENT_FORWARDER_EXPERIMENT_VIEWED_TABLE_SUFFIX,
  EVENT_FORWARDER_FEATURE_USAGE_TABLE_SUFFIX,
] as const;
const EVENT_FORWARDER_TABLE_NAME_SEPARATOR = "_";
const LONGEST_EVENT_FORWARDER_TABLE_SUFFIX_LENGTH = Math.max(
  ...EVENT_FORWARDER_TABLE_SUFFIXES.map((suffix) => suffix.length),
);
const DEFAULT_EVENT_FORWARDER_BIGQUERY_TABLE_NAME = `${DEFAULT_EVENT_FORWARDER_TABLE_PREFIX}${EVENT_FORWARDER_TABLE_NAME_SEPARATOR}${EVENT_FORWARDER_EVENTS_TABLE_SUFFIX}`;
const DEFAULT_EVENT_FORWARDER_SNOWFLAKE_TABLE_NAME =
  `${DEFAULT_EVENT_FORWARDER_TABLE_PREFIX}${EVENT_FORWARDER_TABLE_NAME_SEPARATOR}${EVENT_FORWARDER_EVENTS_TABLE_SUFFIX}`.toUpperCase();

function eventForwarderTableNameFromPrefix(
  prefix: string,
  suffix: string,
): string {
  return `${prefix}${EVENT_FORWARDER_TABLE_NAME_SEPARATOR}${suffix}`;
}

export type BigQueryEventForwarderDestination = {
  dataset: string;
  table: string;
  projectId?: string;
};

export type SnowflakeEventForwarderDestination = {
  database: string;
  schema: string;
  table: string;
};

export type EventForwarderResolvedTableNames = {
  events: string;
  experimentViewed: string;
  featureUsage: string;
};

export type BigQueryEventForwarderTablePrefix = {
  dataset: string;
  tablePrefix: string;
  projectId?: string;
};

export type SnowflakeEventForwarderTablePrefix = {
  database: string;
  schema: string;
  tablePrefix: string;
};

// BigQuery table names: max 1024 chars, cannot start with a digit.
export function normalizeBigQueryTableNameForEventForwarder(
  raw: string,
  defaultWhenEmpty = DEFAULT_EVENT_FORWARDER_BIGQUERY_TABLE_NAME,
): string {
  let s = raw.normalize("NFKC").trim();
  if (!s) return defaultWhenEmpty;

  const afterSanitize = s
    .replace(/[^\p{L}\p{N}_]+/gu, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");

  if (!afterSanitize) {
    throw new Error(
      "Event forwarder table name must contain at least one letter or number.",
    );
  }

  s = afterSanitize;

  if (/^\p{N}/u.test(s)) {
    s = `_${s}`;
  }

  return s.slice(0, BIGQUERY_TABLE_NAME_MAX_LENGTH);
}

export function isValidBigQueryTableName(name: string): boolean {
  return (
    name.length > 0 &&
    name.length <= BIGQUERY_TABLE_NAME_MAX_LENGTH &&
    /^[\p{L}_][\p{L}\p{N}_]*$/u.test(name)
  );
}

// BigQuery table prefixes follow table-name character rules. A separator
// underscore is inserted before each suffix when deriving full table names.
export function normalizeBigQueryTablePrefixForEventForwarder(
  raw: string,
  defaultWhenEmpty = DEFAULT_EVENT_FORWARDER_TABLE_PREFIX,
): string {
  let s = raw.normalize("NFKC").trim();
  if (!s) return defaultWhenEmpty;

  const afterSanitize = s
    .replace(/[^\p{L}\p{N}_]+/gu, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");

  if (!/[\p{L}\p{N}]/u.test(afterSanitize)) {
    throw new Error(
      "Event forwarder table prefix must contain at least one letter or number.",
    );
  }

  s = afterSanitize;

  if (/^\p{N}/u.test(s)) {
    s = `_${s}`;
  }

  return s.slice(
    0,
    BIGQUERY_TABLE_NAME_MAX_LENGTH -
      LONGEST_EVENT_FORWARDER_TABLE_SUFFIX_LENGTH -
      EVENT_FORWARDER_TABLE_NAME_SEPARATOR.length,
  );
}

export function isValidBigQueryTablePrefix(prefix: string): boolean {
  return EVENT_FORWARDER_TABLE_SUFFIXES.every((suffix) =>
    isValidBigQueryTableName(eventForwarderTableNameFromPrefix(prefix, suffix)),
  );
}

// Snowflake unquoted identifiers: max 255 chars, start with letter or underscore.
export function normalizeSnowflakeTableNameForEventForwarder(
  raw: string,
  defaultWhenEmpty = DEFAULT_EVENT_FORWARDER_SNOWFLAKE_TABLE_NAME,
): string {
  let s = raw.normalize("NFKC").trim();
  if (!s) return defaultWhenEmpty;

  const afterSanitize = s
    .replace(/[^A-Za-z0-9_$]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");

  if (!afterSanitize) {
    throw new Error(
      "Event forwarder table name must contain at least one letter or number.",
    );
  }

  s = afterSanitize;

  if (!/^[A-Za-z_]/.test(s)) {
    s = `_${s}`;
  }

  return s.slice(0, SNOWFLAKE_IDENTIFIER_MAX_LENGTH).toUpperCase();
}

export function isValidSnowflakeTableName(name: string): boolean {
  return (
    name.length > 0 &&
    name.length <= SNOWFLAKE_IDENTIFIER_MAX_LENGTH &&
    /^[A-Z_][A-Z0-9_$]*$/.test(name)
  );
}

// Snowflake table prefixes are unquoted identifier fragments. A separator
// underscore is inserted before each uppercased suffix when deriving table names.
export function normalizeSnowflakeTablePrefixForEventForwarder(
  raw: string,
  defaultWhenEmpty = DEFAULT_EVENT_FORWARDER_TABLE_PREFIX,
): string {
  let s = raw.normalize("NFKC").trim();
  if (!s) s = defaultWhenEmpty;

  const afterSanitize = s
    .replace(/[^A-Za-z0-9_$]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");

  if (!/[A-Za-z0-9]/.test(afterSanitize)) {
    throw new Error(
      "Event forwarder table prefix must contain at least one letter or number.",
    );
  }

  s = afterSanitize;

  if (!/^[A-Za-z_]/.test(s)) {
    s = `_${s}`;
  }

  return s
    .slice(
      0,
      SNOWFLAKE_IDENTIFIER_MAX_LENGTH -
        LONGEST_EVENT_FORWARDER_TABLE_SUFFIX_LENGTH -
        EVENT_FORWARDER_TABLE_NAME_SEPARATOR.length,
    )
    .toUpperCase();
}

export function isValidSnowflakeTablePrefix(prefix: string): boolean {
  return EVENT_FORWARDER_TABLE_SUFFIXES.every((suffix) =>
    isValidSnowflakeTableName(
      eventForwarderTableNameFromPrefix(prefix, suffix.toUpperCase()),
    ),
  );
}

export function resolveBigQueryEventForwarderTableNames(
  tablePrefix: string,
): EventForwarderResolvedTableNames {
  const normalizedPrefix =
    normalizeBigQueryTablePrefixForEventForwarder(tablePrefix);
  return {
    events: eventForwarderTableNameFromPrefix(
      normalizedPrefix,
      EVENT_FORWARDER_EVENTS_TABLE_SUFFIX,
    ),
    experimentViewed: eventForwarderTableNameFromPrefix(
      normalizedPrefix,
      EVENT_FORWARDER_EXPERIMENT_VIEWED_TABLE_SUFFIX,
    ),
    featureUsage: eventForwarderTableNameFromPrefix(
      normalizedPrefix,
      EVENT_FORWARDER_FEATURE_USAGE_TABLE_SUFFIX,
    ),
  };
}

export function resolveSnowflakeEventForwarderTableNames(
  tablePrefix: string,
): EventForwarderResolvedTableNames {
  const normalizedPrefix =
    normalizeSnowflakeTablePrefixForEventForwarder(tablePrefix);
  return {
    events: eventForwarderTableNameFromPrefix(
      normalizedPrefix,
      EVENT_FORWARDER_EVENTS_TABLE_SUFFIX.toUpperCase(),
    ),
    experimentViewed: eventForwarderTableNameFromPrefix(
      normalizedPrefix,
      EVENT_FORWARDER_EXPERIMENT_VIEWED_TABLE_SUFFIX.toUpperCase(),
    ),
    featureUsage: eventForwarderTableNameFromPrefix(
      normalizedPrefix,
      EVENT_FORWARDER_FEATURE_USAGE_TABLE_SUFFIX.toUpperCase(),
    ),
  };
}

function accountHasRegionOrCloudSegment(account: string): boolean {
  return account.includes(".");
}

function looksLikeBareLocator(account: string): boolean {
  if (/^[a-z0-9]+$/i.test(account)) return true;
  return /^[a-z]{1,4}\d+(?:_[a-z0-9]+)?$/i.test(account);
}

// Derives Snowflake HTTPS URL from account id; bare locators return null.
export function tryDeriveSnowflakeAccessUrlFromAccount(
  account: string,
): string | null {
  const trimmed = account.trim();
  if (!trimmed) return null;

  if (
    !accountHasRegionOrCloudSegment(trimmed) &&
    looksLikeBareLocator(trimmed)
  ) {
    return null;
  }

  const hostname = `${trimmed.replace(/_/g, "-")}${SNOWFLAKE_HOST_SUFFIX}`;
  return `https://${hostname}`;
}

export function normalizeSnowflakeEventForwarderAccessUrl(
  input: string,
): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("Snowflake URL is required.");
  }

  let urlString = trimmed;
  if (!/^https?:\/\//i.test(urlString)) {
    urlString = `https://${urlString}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    throw new Error("Snowflake URL is not a valid URL.");
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Snowflake URL must use http or https.");
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!hostname.endsWith(SNOWFLAKE_HOST_SUFFIX)) {
    throw new Error(
      `Snowflake URL hostname must end with ${SNOWFLAKE_HOST_SUFFIX}.`,
    );
  }

  const portSuffix =
    parsed.port && parsed.port !== "443" ? `:${parsed.port}` : "";
  return `https://${parsed.hostname}${portSuffix}`;
}

function unwrapIdentifier(segment: string): string {
  const trimmed = segment.trim();
  if (trimmed.startsWith("`") && trimmed.endsWith("`") && trimmed.length >= 2) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function splitQualifiedPath(input: string): string[] {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("Destination is required.");
  }

  return trimmed.split(".").map(unwrapIdentifier);
}

function assertNonEmptySegment(segment: string, label: string): string {
  if (!segment.trim()) {
    throw new Error(`${label} cannot be empty.`);
  }
  return segment.trim();
}

export function parseBigQueryEventForwarderDestination(
  input: string,
): BigQueryEventForwarderDestination {
  const segments = splitQualifiedPath(input);

  if (segments.length === 2) {
    return {
      dataset: assertNonEmptySegment(segments[0], "Dataset"),
      table: assertNonEmptySegment(segments[1], "Table"),
    };
  }

  if (segments.length === 3) {
    return {
      projectId: assertNonEmptySegment(segments[0], "Project"),
      dataset: assertNonEmptySegment(segments[1], "Dataset"),
      table: assertNonEmptySegment(segments[2], "Table"),
    };
  }

  throw new Error(
    "BigQuery destination must be dataset.table or project.dataset.table.",
  );
}

export function formatBigQueryEventForwarderDestination(
  destination: BigQueryEventForwarderDestination,
): string {
  const { dataset, table, projectId } = destination;
  if (projectId?.trim()) {
    return `${projectId.trim()}.${dataset.trim()}.${table.trim()}`;
  }
  return `${dataset.trim()}.${table.trim()}`;
}

export function parseBigQueryEventForwarderTablePrefix(
  input: string,
): BigQueryEventForwarderTablePrefix {
  const segments = splitQualifiedPath(input);

  if (segments.length === 2) {
    return {
      dataset: assertNonEmptySegment(segments[0], "Dataset"),
      tablePrefix: normalizeBigQueryTablePrefixForEventForwarder(
        assertNonEmptySegment(segments[1], "Table prefix"),
      ),
    };
  }

  if (segments.length === 3) {
    return {
      projectId: assertNonEmptySegment(segments[0], "Project"),
      dataset: assertNonEmptySegment(segments[1], "Dataset"),
      tablePrefix: normalizeBigQueryTablePrefixForEventForwarder(
        assertNonEmptySegment(segments[2], "Table prefix"),
      ),
    };
  }

  throw new Error(
    "BigQuery destination prefix must be dataset.prefix or project.dataset.prefix.",
  );
}

export function formatBigQueryEventForwarderTablePrefix(
  destination: BigQueryEventForwarderTablePrefix,
): string {
  const { dataset, tablePrefix, projectId } = destination;
  if (projectId?.trim()) {
    return `${projectId.trim()}.${dataset.trim()}.${tablePrefix.trim()}`;
  }
  return `${dataset.trim()}.${tablePrefix.trim()}`;
}

export function parseSnowflakeEventForwarderDestination(
  input: string,
): SnowflakeEventForwarderDestination {
  const segments = splitQualifiedPath(input);

  if (segments.length !== 3) {
    throw new Error(
      "Snowflake destination must be DATABASE.SCHEMA.TABLE (three dot-separated parts).",
    );
  }

  const database = assertNonEmptySegment(segments[0], "Database").toUpperCase();
  const schema = assertNonEmptySegment(segments[1], "Schema").toUpperCase();
  const rawTable = assertNonEmptySegment(segments[2], "Table");

  return {
    database,
    schema,
    table: normalizeSnowflakeTableNameForEventForwarder(rawTable),
  };
}

export function formatSnowflakeEventForwarderDestination(
  destination: SnowflakeEventForwarderDestination,
): string {
  return `${destination.database.trim()}.${destination.schema.trim()}.${destination.table.trim()}`;
}

export function parseSnowflakeEventForwarderTablePrefix(
  input: string,
): SnowflakeEventForwarderTablePrefix {
  const segments = splitQualifiedPath(input);

  if (segments.length !== 3) {
    throw new Error(
      "Snowflake destination prefix must be DATABASE.SCHEMA.PREFIX (three dot-separated parts).",
    );
  }

  const database = assertNonEmptySegment(segments[0], "Database").toUpperCase();
  const schema = assertNonEmptySegment(segments[1], "Schema").toUpperCase();
  const rawPrefix = assertNonEmptySegment(segments[2], "Table prefix");

  return {
    database,
    schema,
    tablePrefix: normalizeSnowflakeTablePrefixForEventForwarder(rawPrefix),
  };
}

export function formatSnowflakeEventForwarderTablePrefix(
  destination: SnowflakeEventForwarderTablePrefix,
): string {
  return `${destination.database.trim()}.${destination.schema.trim()}.${destination.tablePrefix.trim()}`;
}
