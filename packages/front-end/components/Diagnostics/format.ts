export function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + "…";
}

/**
 * Filter keys are interpolated into a RegExp by transformQuery, so a key with
 * regex metacharacters throws at render. Warehouse-derived names (dimensions)
 * are not guaranteed to be identifier-safe, so drop the ones that aren't —
 * they keep their column and lose only `key:value` search syntax.
 */
export function toSafeFilterKeys(keys: string[]): string[] {
  return keys.filter((k) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(k));
}
