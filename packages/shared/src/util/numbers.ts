/**
 * Parses `value` as an integer. Use when reading datasource / form fields
 * that may be string, number, or missing.
 *
 * Uses `Number(value)` (after trimming strings), then
 * `Number.isInteger(n) ? n : Math.trunc(n)` so decimals truncate toward zero
 * and `NaN`/`Infinity` are rejected. Unlike `parseInt`, there is no partial
 * parse of strings (`"123abc"` → `NaN`). Blank strings are treated as missing.
 *
 * Results must be **safe integers**; values outside that range return
 * `undefined`.
 *
 * Returns `fallback` for `undefined`, `null`, blank strings, non-finite
 * numbers, or any other invalid input.
 */
export function parseIntWithDefault(value: unknown, fallback: number): number {
  const n = parseOptionalInt(value);
  if (n === undefined) return fallback;
  return n;
}

/** Parsed integer or `undefined` when missing, blank, or not a valid integer. */
export function parseOptionalInt(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string" && value.trim() === "") return undefined;
  const n = typeof value === "string" ? Number(value.trim()) : Number(value);
  if (!Number.isFinite(n)) return undefined;
  const int = Number.isInteger(n) ? n : Math.trunc(n);
  if (!Number.isSafeInteger(int)) return undefined;
  return int;
}

/**
 * Parse an integer with `fallback` when missing/invalid, then cap at `max`.
 * Typical for query limits where values above `max` should become `max`, not the default.
 */
export function parseIntWithDefaultCapped(
  value: unknown,
  fallback: number,
  max: number,
): number {
  return Math.min(parseIntWithDefault(value, fallback), max);
}

export type ParseEnvIntOptions = {
  /** Env var name (for warnings when the value is invalid or outside bounds). */
  name: string;
  min?: number;
  max?: number;
};

/**
 * Parse an integer from a Node `process.env` entry (`string | undefined`).
 * Only `undefined` is treated as unset (uses `defaultValue`). Other values
 * are parsed with `parseOptionalInt`; invalid or out-of-range values fall back
 * to `defaultValue` and emit **`console.warn`**.
 */
export function parseEnvInt(
  value: string | undefined,
  defaultValue: number,
  opts: ParseEnvIntOptions,
): number {
  if (value === undefined) return defaultValue;
  const n = parseOptionalInt(value);
  const invalid =
    n === undefined ||
    (opts.min !== undefined && n < opts.min) ||
    (opts.max !== undefined && n > opts.max);
  if (invalid) {
    // eslint-disable-next-line no-console -- shared does not import app loggers
    console.warn(
      `WARNING! Invalid value for ${opts.name}: "${value ?? ""}". Falling back to default: ${defaultValue}`,
    );
    return defaultValue;
  }
  return n;
}

/**
 * Display arbitrary table / query cell values for UI:
 * - `null` / `undefined` → empty string
 * - booleans → `"true"` / `"false"`
 * - finite numbers → `toLocaleString()`; non-finite → `String(number)`
 * - strings → trim; if the trim parses as a finite number, format like numbers;
 *   whitespace-only strings are returned unchanged
 * - `Date` (finite) → `toLocaleString()`
 * - `bigint` → decimal string
 * - plain objects and arrays → `JSON.stringify`
 * - symbols and other values → `String(value)`
 */
export function formatNumericLikeForDisplay(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "boolean") return String(value);
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") {
    return Number.isFinite(value) ? value.toLocaleString() : String(value);
  }
  if (typeof value === "string") {
    const t = value.trim();
    if (t === "") return value;
    const n = Number(t);
    if (Number.isFinite(n)) return n.toLocaleString();
    return value;
  }
  if (typeof value === "symbol") return String(value);
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? "" : value.toLocaleString();
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}
