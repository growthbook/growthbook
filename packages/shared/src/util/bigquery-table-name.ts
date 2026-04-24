/** BigQuery table names are max 1024 chars; cannot start with a digit. */

const BIGQUERY_TABLE_NAME_MAX_LENGTH = 1024;

export const DEFAULT_EVENT_FORWARDER_BIGQUERY_TABLE_NAME = "gb_events";

/**
 * Maps user input to a BigQuery-safe table ID: trims, replaces disallowed characters
 * with underscores, collapses repeated underscores, prefixes with `_` when the first
 * character would be a digit, and truncates to BigQuery length limits.
 *
 * Allowed characters follow BigQuery’s resource naming (letters including Unicode,
 * numbers including Unicode digits, underscores).
 *
 * If `raw` is empty or whitespace-only, returns `defaultWhenEmpty`. If `raw` has
 * visible characters but none survive sanitization (e.g. only punctuation),
 * throws — callers must not swallow that when the user intended a specific name.
 */
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
