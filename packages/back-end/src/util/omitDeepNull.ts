/**
 * Recursively removes properties whose value is `null`, so JSON matches Zod
 * `.optional()` semantics (absent key) instead of explicit JSON `null`.
 */
export function omitDeepNull<T>(value: T): T {
  return inner(value) as T;
}

function inner(value: unknown): unknown {
  if (value === null) {
    return undefined;
  }
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "object") {
    return value;
  }
  if (value instanceof Date) {
    return value;
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => inner(item))
      .filter((item) => item !== undefined && item !== null);
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const cleaned = inner(v);
    if (cleaned !== undefined) {
      out[k] = cleaned;
    }
  }
  return out;
}
