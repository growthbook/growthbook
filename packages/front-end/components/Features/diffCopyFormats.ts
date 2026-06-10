import { createPatch } from "diff";
import type { FeatureRevisionDiff } from "@/hooks/useFeatureRevisionDiff";

// The shapes a change-set can be copied to the clipboard as.
export type CopyDiffFormat = "formatted" | "minimal-json" | "full-json" | "llm";

export const COPY_DIFF_FORMATS: {
  value: CopyDiffFormat;
  label: string;
  description: string;
}[] = [
  {
    value: "formatted",
    label: "Formatted changes",
    description: "Human-readable details of each change",
  },
  {
    value: "minimal-json",
    label: "Minimal JSON diff",
    description: "Valid JSON describing only what changed",
  },
  {
    value: "full-json",
    label: "Full JSON",
    description: "Valid JSON with complete before/after",
  },
  {
    value: "llm",
    label: "LLM formatted",
    description: "XML diff + resulting state per entity",
  },
];

// Whole before/after object of a top-level entity (e.g. the feature revision).
export type RawEntity = { before: unknown; after: unknown; title?: string };

export type DiffCopyInput = {
  // Identifies the change-set as a whole (e.g. the feature key).
  entityName: string;
  // What kind of object the change-set belongs to. All current surfaces are
  // feature revisions; pass a different type if this is reused elsewhere
  // (e.g. "saved-group").
  entityType?: string;
  // Per-field/per-entity changes (already filtered to a !== b). Includes
  // supplemental entities (ramp schedules/actions) flagged `supplemental`.
  diffs: FeatureRevisionDiff[];
  // The entire before/after object of the primary entity, when the surface can
  // supply it. Used by the "Full JSON" and "LLM" formats.
  raw?: RawEntity;
};

function toJson(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}

// A top-level entity with its complete before/after, derived from `raw` (the
// primary object) plus any supplemental entities carried in `diffs`. Used by
// the LLM formats, which render one `<{type} name="{name}">` block per entity.
type WholeEntity = {
  name: string;
  type: string;
  before: string;
  after: string;
};

function collectWholeEntities({
  entityName,
  entityType = "feature",
  diffs,
  raw,
}: DiffCopyInput): WholeEntity[] {
  const entities: WholeEntity[] = [];
  if (raw) {
    const before = toJson(raw.before);
    const after = toJson(raw.after);
    if (before !== after) {
      entities.push({ name: entityName, type: entityType, before, after });
    }
  } else {
    // No whole-shape available — treat each non-supplemental field diff as its
    // own entity so nothing is lost.
    for (const d of diffs.filter((d) => !d.supplemental)) {
      entities.push({ name: d.title, type: "field", before: d.a, after: d.b });
    }
  }
  for (const d of diffs.filter((d) => d.supplemental)) {
    entities.push({
      name: d.entityName ?? d.title,
      type: d.entityType ?? "entity",
      before: d.a,
      after: d.b,
    });
  }
  return entities;
}

// Fallback for "Formatted changes" when the rendered detail isn't available
// (the UI prefers the on-screen formatted render's text): a grouped,
// plain-language list of changes derived from the diff badges.
export function buildSummary({
  entityName,
  entityType = "feature",
  diffs,
}: DiffCopyInput): string {
  if (diffs.length === 0) return `No changes to ${entityType} "${entityName}".`;

  const lines: string[] = [`Changes to ${entityType} "${entityName}":`, ""];
  for (const d of diffs) {
    lines.push(d.title);
    const labels = (d.badges ?? []).map((b) => b.label);
    if (labels.length > 0) {
      for (const label of labels) lines.push(`  - ${label}`);
    } else {
      lines.push("  - updated");
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

// Parse a stored diff-side string back into a JSON value. Non-JSON content
// (plain strings, partial renders) is kept verbatim as a string.
function tryParse(value: string): unknown {
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
): Record<string, unknown> {
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

// ── "Minimal JSON diff": a valid-JSON document describing only what changed ──
// Built from the same whole before/after shapes (`raw`) that feed the
// "Raw JSON" render, so `changes` is keyed by the actual revision schema
// fields (defaultValue, environmentsEnabled, rules, …) — not the UI section
// labels. Shape:
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
// Objects are pruned to changed keys; id-keyed arrays (rules) are bucketed
// into added/removed/modified items — each with its array position — so the
// output stays minimal without losing order information. Supplemental
// entities (ramp schedules / actions) are separate top-level objects, matching
// how the Raw JSON view renders them. Falls back to the per-section diffs
// when a surface can't supply the whole shapes.
export function buildMinimalJsonDiff({
  entityName,
  entityType = "feature",
  diffs,
  raw,
}: DiffCopyInput): string {
  const changes: Record<string, unknown>[] = [];

  const rawBefore = raw?.before;
  const rawAfter = raw?.after;
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

  return JSON.stringify(
    {
      name: entityName,
      type: entityType,
      changes,
      ...(supplemental.length > 0 ? { supplemental } : {}),
    },
    null,
    2,
  );
}

// ── "Full JSON": a valid-JSON document with each entity's complete shape ─────
// Same envelope as the minimal diff — the root *is* the primary entity, with
// supplemental entities in an optional `supplemental` array. Shape:
// {
//   "name": "...", "type": "feature",
//   "before": …|null, "after": …|null,
//   "supplemental": [{ "name": "...", "type": "...",
//                      "before": …|null, "after": …|null }]
// }
// When the surface can't supply the whole before/after shape, the primary
// entity's per-field diffs are emitted under `fields` instead.
export function buildFullJson({
  entityName,
  entityType = "feature",
  diffs,
  raw,
}: DiffCopyInput): string {
  // `raw` sides may be live objects or pre-serialized JSON strings.
  const parseSide = (value: unknown): unknown =>
    typeof value === "string" ? tryParse(value) : (value ?? null);

  const supplemental = diffs
    .filter((d) => d.supplemental)
    .map((d) => ({
      name: d.entityName ?? d.title,
      type: d.entityType ?? "entity",
      before: tryParse(d.a),
      after: tryParse(d.b),
    }));

  return JSON.stringify(
    {
      name: entityName,
      type: entityType,
      ...(raw
        ? { before: parseSide(raw.before), after: parseSide(raw.after) }
        : {
            fields: diffs
              .filter((d) => !d.supplemental)
              .map((d) => ({
                name: d.title,
                before: tryParse(d.a),
                after: tryParse(d.b),
              })),
          }),
      ...(supplemental.length > 0 ? { supplemental } : {}),
    },
    null,
    2,
  );
}

// ── "LLM / agents": XML-wrapped before/after per entity ──────────────────────
function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Unified +/- diff body for a single entity, with the noisy "Index:" / "==="
// header lines createPatch prepends stripped off. `context` controls how many
// unchanged lines surround each hunk.
function unifiedDiffBody(
  title: string,
  before: string,
  after: string,
  context = 3,
): string {
  const patch = createPatch(
    title,
    ensureTrailingNewline(before),
    ensureTrailingNewline(after),
    "before",
    "after",
    { context },
  );
  return patch.split("\n").slice(2).join("\n").trim();
}

// Each entity is wrapped in a tag named after its type with its name as an
// attribute — the same name/type pattern as the JSON formats (e.g.
// `<feature name="checkout-flow">`). Per entity, the payload pairs a unified
// +/- diff (what changed) with the complete resulting object (the full state
// after the change); the prior state is recoverable from those two, so the
// before-object is omitted to keep the payload lean.
export function buildLLMDiff(input: DiffCopyInput): string {
  const { entityName, entityType = "feature", diffs } = input;
  const entities = collectWholeEntities(input);

  const summary =
    diffs.length > 0
      ? diffs.map((d) => `  - ${d.title}`).join("\n")
      : "  - (no changes)";

  const parts: string[] = [
    `<change-set name="${escapeAttr(entityName)}" type="${escapeAttr(
      entityType,
    )}">`,
    "<summary>",
    summary,
    "</summary>",
  ];

  for (const e of entities) {
    const tag = e.type;
    // A unified +/- diff with surrounding context so the change is obvious at a
    // glance without needing to diff two large blobs by hand.
    parts.push(
      "",
      `<${tag} name="${escapeAttr(e.name)}">`,
      "<diff>",
      unifiedDiffBody(e.name, e.before, e.after) || "(no textual diff)",
      "</diff>",
      // The complete resulting object, so the model can reason about the full
      // final state without stitching hunks together.
      "<after>",
      e.after.trim() || "(none)",
      "</after>",
      `</${tag}>`,
    );
  }

  parts.push("", "</change-set>");
  return parts.join("\n");
}

export function formatDiffForCopy(
  format: CopyDiffFormat,
  input: DiffCopyInput,
): string {
  switch (format) {
    case "formatted":
      return buildSummary(input);
    case "minimal-json":
      return buildMinimalJsonDiff(input);
    case "full-json":
      return buildFullJson(input);
    case "llm":
      return buildLLMDiff(input);
  }
}
