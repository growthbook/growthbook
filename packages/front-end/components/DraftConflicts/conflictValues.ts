export function formatConflictValue(v: unknown): string {
  if (v === undefined) return "(removed)";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  if (!s) return '""';
  return s;
}

export function formatChunkValue(
  entity: Record<string, unknown> | null,
  fields: string[],
): string {
  if (!entity) return "(removed)";
  if (fields.length === 1) return formatConflictValue(entity[fields[0]]);
  return formatConflictValue(
    Object.fromEntries(
      fields.filter((f) => entity[f] !== undefined).map((f) => [f, entity[f]]),
    ),
  );
}

// Drops editor-only fields, which would be diff noise.
export function projectFormValues(
  values: Record<string, unknown>,
  reference: Array<Record<string, unknown> | null | undefined>,
): Record<string, unknown> {
  const keys = new Set<string>();
  for (const r of reference) {
    if (r) Object.keys(r).forEach((k) => keys.add(k));
  }
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    if (values[k] !== undefined) out[k] = values[k];
  }
  return out;
}
