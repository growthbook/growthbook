import type { SqlIdentifierQuote } from "shared/types/sql";

const BARE_JSON_PATH_SEGMENT = /^[a-zA-Z_][a-zA-Z0-9_]*(\[\d+\])*$/;

// Quotes a JSON key as an identifier. Backslashes are doubled along with the
// quote so the key can't close the identifier early, whether or not the
// warehouse reads a backslash inside quotes as an escape.
export function quoteJsonKey(key: string, q: SqlIdentifierQuote): string {
  return `${q}${key
    .replace(/\\/g, "\\\\")
    .split(q)
    .join(q + q)}${q}`;
}

// For dialects that write a JSON path as SQL syntax (`col:a.b`) rather than in
// a string literal. JSON keys come from sampled warehouse rows, so any segment
// that isn't a bare (optionally array-indexed) identifier is quoted.
export function quoteJsonPathSegments(
  path: string,
  q: SqlIdentifierQuote,
): string {
  return path
    .split(".")
    .map((segment) =>
      BARE_JSON_PATH_SEGMENT.test(segment) ? segment : quoteJsonKey(segment, q),
    )
    .join(".");
}
