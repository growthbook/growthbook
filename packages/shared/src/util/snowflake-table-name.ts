/** Snowflake unquoted identifiers are max 255 chars and start with a letter or underscore. */

const SNOWFLAKE_IDENTIFIER_MAX_LENGTH = 255;

export const DEFAULT_EVENT_FORWARDER_SNOWFLAKE_TABLE_NAME = "GB_EVENTS";

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
