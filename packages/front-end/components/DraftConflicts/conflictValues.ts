// Generous, but bounded: a saved group's id list or a big JSON value would
// otherwise render in full.
const MAX_VALUE_CHARS = 400;

export function formatConflictValue(v: unknown): string {
  if (v === undefined) return "(removed)";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  if (!s) return '""';
  return s.length > MAX_VALUE_CHARS ? `${s.slice(0, MAX_VALUE_CHARS)}…` : s;
}

export function formatList(list: unknown[]): string {
  // Bounded up front so a huge list never stringifies in full.
  const bounded = list.slice(0, 120);
  const s = `[${bounded.map((v) => JSON.stringify(v)).join(", ")}]`;
  return s.length > MAX_VALUE_CHARS || bounded.length < list.length
    ? `${s.slice(0, MAX_VALUE_CHARS)}…`
    : s;
}

// Renders a project-id list by name, for conflict rows over project fields.
export function namedProjectsFormatter(
  getProjectById: (id: string) => { name: string } | null,
): (value: unknown) => string {
  return (v) =>
    formatList(
      ((v as string[]) ?? []).map((id) => getProjectById(id)?.name ?? id),
    );
}

// The fixed scope label the flag stands for: allEnvironments and
// targetingAllProjects both read as "All Environments" / "All Projects".
function scopeLabel(flagField: string): string {
  return flagField
    .replace(/^.*?(all)/i, "$1")
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

/**
 * A chunk pairing an "everything" flag with its list (allEnvironments +
 * environments) reads as the value in force, not as the raw pair.
 */
function formatFlaggedList(
  entity: Record<string, unknown>,
  fields: string[],
  formatters?: Record<string, (value: unknown) => string>,
): string | null {
  if (fields.length !== 2) return null;
  const flagField = fields.find((f) => typeof entity[f] === "boolean");
  if (!flagField) return null;
  // The list is often absent when the flag is on, so it can't be required here.
  const listField = fields.find((f) => f !== flagField) as string;
  const list = entity[listField];
  if (list !== undefined && !Array.isArray(list)) return null;
  if (entity[flagField]) return scopeLabel(flagField);
  const format = formatters?.[listField];
  return format
    ? format((list as unknown[]) ?? [])
    : formatList((list as unknown[]) ?? []);
}

export function formatChunkValue(
  entity: Record<string, unknown> | null,
  fields: string[],
  // Per-field display, for values the control shows in another unit.
  formatters?: Record<string, (value: unknown) => string>,
): string {
  if (!entity) return "(removed)";
  if (fields.length === 1) {
    const only = entity[fields[0]];
    const format = formatters?.[fields[0]];
    if (format && only !== undefined) return format(only);
    return Array.isArray(only) ? formatList(only) : formatConflictValue(only);
  }
  const flagged = formatFlaggedList(entity, fields, formatters);
  if (flagged !== null) return flagged;
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
