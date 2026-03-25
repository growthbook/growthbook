/**
 * Parses `value` as a base-10 integer. Use when reading datasource / form fields
 * that may be string, number, or missing.
 *
 * Returns `fallback` for `undefined`, `null`, blank strings, non-finite numbers,
 * or strings that do not start with a valid integer (e.g. `"abc"`).
 */
export function parseIntWithDefault(value: unknown, fallback: number): number {
  if (value === undefined || value === null) return fallback;
  const t = typeof value === "string" ? value.trim() : String(value);
  if (t === "") return fallback;
  const n = Number.parseInt(t, 10);
  return Number.isNaN(n) ? fallback : n;
}
