const BIGQUERY_TABLE_NAME_MAX_LENGTH = 1024;
const SNOWFLAKE_IDENTIFIER_MAX_LENGTH = 255;
const SNOWFLAKE_HOST_SUFFIX = ".snowflakecomputing.com";

export const DEFAULT_EVENT_FORWARDER_BIGQUERY_TABLE_NAME = "gb_events";
export const DEFAULT_EVENT_FORWARDER_SNOWFLAKE_TABLE_NAME = "GB_EVENTS";

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
    throw new Error("Destination table is required.");
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
