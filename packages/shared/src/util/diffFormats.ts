// Schema-keyed JSON formats for change-sets (feature revisions, etc.). These
// produce the same shapes that the front-end "Copy as" dropdown uses, and are
// shared with the back-end so the REST API can return identical diffs.
//
// The two object-returning entry points are:
//   - buildMinimalJsonDiffObject: only the changed fields, with id-keyed arrays
//     (rules) bucketed into added/removed/modified and reorder detection.
//   - buildFullJsonObject: each entity's whole before/after, suitable for
//     callers that want to reason about the complete shape.
//
// The string-returning variants (buildMinimalJsonDiff / buildFullJson) just
// JSON.stringify the object form with 2-space indent; the front-end uses these
// for clipboard copy.

// ---- Inputs ----

// Whole before/after object of a top-level entity (e.g. the feature revision).
export type RawEntity = { before: unknown; after: unknown; title?: string };

// Per-field/per-entity diff entry. `a` / `b` are pre-serialized JSON strings
// (the format the front-end's diff viewer consumes). Supplemental entities
// (e.g. ramp schedules carried alongside a feature revision) set
// `supplemental: true` plus their own `entityName` / `entityType`.
export type DiffEntry = {
  title: string;
  a: string;
  b: string;
  entityName?: string;
  entityType?: string;
  supplemental?: boolean;
};

export type DiffCopyInput = {
  // Identifies the change-set as a whole (e.g. the feature key).
  entityName: string;
  // What kind of object the change-set belongs to. Defaults to "feature".
  entityType?: string;
  // Per-field/per-entity changes (already filtered to a !== b). Includes
  // supplemental entities flagged `supplemental`.
  diffs: DiffEntry[];
  // The entire before/after object of the primary entity, when the surface can
  // supply it. Used by the "Full JSON" and "Minimal JSON" formats.
  raw?: RawEntity;
};

// ---- Small helpers (also exported so the front-end formatted/LLM builders
//      can reuse them) ----

export function tryParse(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// Keep only the keys whose values differ, so a modified object reads as a
// focused before/after instead of repeating the whole shape.
function changedObjectKeys(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): { before: Record<string, unknown>; after: Record<string, unknown> } {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const key of keys) {
    if (deepEqual(before[key], after[key])) continue;
    if (key in before) b[key] = before[key];
    if (key in after) a[key] = after[key];
  }
  return { before: b, after: a };
}

// Diff two arrays of `id`-keyed objects into added / removed / modified
// buckets with positional information (arrays like rules are order-sensitive):
// - added entries carry the item's index in the after array
// - removed entries carry the item's index in the before array
// - modified entries carry both beforeIndex and afterIndex
// - when the relative order of surviving items changed, `reordered: true` is
//   set along with `order` — the full id sequence of the after array
// Returns null when the arrays aren't uniformly id-keyed (caller falls back
// to whole before/after arrays).
function diffArraysById(
  before: unknown[],
  after: unknown[],
): Record<string, unknown> | null {
  const idOf = (item: unknown): string | null =>
    isPlainObject(item) && typeof item.id === "string" ? item.id : null;

  type Positioned = { item: Record<string, unknown>; index: number };
  const beforeById = new Map<string, Positioned>();
  for (const [index, item] of before.entries()) {
    const id = idOf(item);
    if (!id || beforeById.has(id)) return null;
    beforeById.set(id, { item: item as Record<string, unknown>, index });
  }
  const afterById = new Map<string, Positioned>();
  for (const [index, item] of after.entries()) {
    const id = idOf(item);
    if (!id || afterById.has(id)) return null;
    afterById.set(id, { item: item as Record<string, unknown>, index });
  }

  const added = Array.from(afterById)
    .filter(([id]) => !beforeById.has(id))
    .map(([, { item, index }]) => ({ index, value: item }));
  const removed = Array.from(beforeById)
    .filter(([id]) => !afterById.has(id))
    .map(([, { item, index }]) => ({ index, value: item }));

  const modified: Record<string, unknown>[] = [];
  for (const [id, b] of beforeById) {
    const a = afterById.get(id);
    if (!a || deepEqual(a.item, b.item)) continue;
    const delta = changedObjectKeys(b.item, a.item);
    modified.push({
      id,
      beforeIndex: b.index,
      afterIndex: a.index,
      before: delta.before,
      after: delta.after,
    });
  }

  // Reorder detection compares the *relative* order of items present in both
  // arrays, so insertions/removals (which shift absolute indices) don't count
  // as a reorder on their own.
  const beforeCommon = [...beforeById.keys()].filter((id) => afterById.has(id));
  const afterCommon = [...afterById.keys()].filter((id) => beforeById.has(id));
  const reordered = !deepEqual(beforeCommon, afterCommon);

  return {
    added,
    removed,
    modified,
    ...(reordered ? { reordered: true, order: [...afterById.keys()] } : {}),
  };
}

// Describe a single value transition: added / removed / modified, with
// object pruning and positional array bucketing for the modified case.
function describeChange(
  before: unknown,
  after: unknown,
): { change: DiffChangeKind; [key: string]: unknown } {
  const beforeAbsent = (before ?? null) === null;
  const afterAbsent = (after ?? null) === null;
  if (beforeAbsent && !afterAbsent) {
    return { change: "added", value: after };
  }
  if (!beforeAbsent && afterAbsent) {
    return { change: "removed", value: before };
  }
  if (Array.isArray(before) && Array.isArray(after)) {
    const items = diffArraysById(before, after);
    if (items) return { change: "modified", items };
  }
  if (isPlainObject(before) && isPlainObject(after)) {
    const delta = changedObjectKeys(before, after);
    return { change: "modified", before: delta.before, after: delta.after };
  }
  return { change: "modified", before, after };
}

// Parse `raw.before` / `raw.after` whether they arrive as live objects (the
// usual back-end case) or as pre-serialized JSON strings (the front-end's
// existing "Raw JSON" pipeline path).
function parseSide(value: unknown): unknown {
  return typeof value === "string" ? tryParse(value) : (value ?? null);
}

// ---- Output types ----

export type DiffChangeKind = "added" | "removed" | "modified";

// describeChange always emits a `change` discriminator on top of the
// caller-provided identification (`field` for top-level entries, `name`+`type`
// for supplemental entities). Extra payload keys vary by change kind (`value`
// for added/removed, `before`+`after` or `items` for modified) and are
// expressed as the optional index signature.
export type MinimalDiffChangeEntry = {
  field: string;
  change: DiffChangeKind;
  [key: string]: unknown;
};

export type MinimalDiffSupplementalEntry = {
  name: string;
  type: string;
  change: DiffChangeKind;
  [key: string]: unknown;
};

export type MinimalJsonDiffOutput = {
  name: string;
  type: string;
  changes: MinimalDiffChangeEntry[];
  supplemental?: MinimalDiffSupplementalEntry[];
};

// `before`/`after` are present when whole shapes were supplied; otherwise the
// per-field `fields` array is emitted instead. Discriminated via the keys.
export type FullJsonOutput =
  | {
      name: string;
      type: string;
      before: unknown;
      after: unknown;
      supplemental?: Array<{
        name: string;
        type: string;
        before: unknown;
        after: unknown;
      }>;
    }
  | {
      name: string;
      type: string;
      fields: Array<{ name: string; before: unknown; after: unknown }>;
      supplemental?: Array<{
        name: string;
        type: string;
        before: unknown;
        after: unknown;
      }>;
    };

// ---- Minimal JSON diff (object form) ----
//
// Shape:
// {
//   "name": "...", "type": "feature",
//   "changes": [
//     { "field": "environmentsEnabled", "change": "modified",
//       "before": { "production": true }, "after": { "production": false } },
//     { "field": "rules", "change": "modified",
//       "items": { "added": [{ "index": 2, "value": … }],
//                  "removed": [{ "index": 0, "value": … }],
//                  "modified": [{ "id": "…", "beforeIndex": 1,
//                                 "afterIndex": 0, "before": …, "after": … }],
//                  "reordered": true, "order": ["id1", "id2", …] } }
//   ],
//   "supplemental": [{ "name": "Spring rollout", "type": "ramp-schedule",
//                      "change": "added", "value": … }]
// }
export function buildMinimalJsonDiffObject({
  entityName,
  entityType = "feature",
  diffs,
  raw,
}: DiffCopyInput): MinimalJsonDiffOutput {
  const changes: MinimalDiffChangeEntry[] = [];

  const rawBefore = raw ? parseSide(raw.before) : undefined;
  const rawAfter = raw ? parseSide(raw.after) : undefined;
  const beforeObj = isPlainObject(rawBefore) ? rawBefore : null;
  const afterObj = isPlainObject(rawAfter) ? rawAfter : null;
  if (beforeObj && afterObj) {
    const keys = new Set([...Object.keys(beforeObj), ...Object.keys(afterObj)]);
    for (const key of keys) {
      const b = beforeObj[key];
      const a = afterObj[key];
      if (deepEqual(b, a)) continue;
      changes.push({ field: key, ...describeChange(b, a) });
    }
  } else {
    // No whole shape available — fall back to the per-section diffs.
    for (const d of diffs.filter((d) => !d.supplemental)) {
      changes.push({
        field: d.title,
        ...describeChange(tryParse(d.a), tryParse(d.b)),
      });
    }
  }

  const supplemental = diffs
    .filter((d) => d.supplemental)
    .map((d) => ({
      name: d.entityName ?? d.title,
      type: d.entityType ?? "entity",
      ...describeChange(tryParse(d.a), tryParse(d.b)),
    }));

  return {
    name: entityName,
    type: entityType,
    changes,
    ...(supplemental.length > 0 ? { supplemental } : {}),
  };
}

export function buildMinimalJsonDiff(input: DiffCopyInput): string {
  return JSON.stringify(buildMinimalJsonDiffObject(input), null, 2);
}

// ---- Full JSON (object form) ----
//
// Shape:
// {
//   "name": "...", "type": "feature",
//   "before": …|null, "after": …|null,
//   "supplemental": [{ "name": "...", "type": "...",
//                      "before": …|null, "after": …|null }]
// }
// When the surface can't supply the whole before/after shape, the primary
// entity's per-field diffs are emitted under `fields` instead.
export function buildFullJsonObject({
  entityName,
  entityType = "feature",
  diffs,
  raw,
}: DiffCopyInput): FullJsonOutput {
  const supplemental = diffs
    .filter((d) => d.supplemental)
    .map((d) => ({
      name: d.entityName ?? d.title,
      type: d.entityType ?? "entity",
      before: tryParse(d.a),
      after: tryParse(d.b),
    }));
  const supplementalField = supplemental.length > 0 ? { supplemental } : {};

  if (raw) {
    return {
      name: entityName,
      type: entityType,
      before: parseSide(raw.before),
      after: parseSide(raw.after),
      ...supplementalField,
    };
  }
  return {
    name: entityName,
    type: entityType,
    fields: diffs
      .filter((d) => !d.supplemental)
      .map((d) => ({
        name: d.title,
        before: tryParse(d.a),
        after: tryParse(d.b),
      })),
    ...supplementalField,
  };
}

export function buildFullJson(input: DiffCopyInput): string {
  return JSON.stringify(buildFullJsonObject(input), null, 2);
}
