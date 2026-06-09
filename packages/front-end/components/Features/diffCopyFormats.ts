import { createPatch } from "diff";
import type { FeatureRevisionDiff } from "@/hooks/useFeatureRevisionDiff";

// The shapes a change-set can be copied to the clipboard as.
export type CopyDiffFormat =
  | "formatted"
  | "minimal-json"
  | "full-json"
  | "llm"
  | "llm-full";

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
    description: "Unified diff of just the changed fields",
  },
  {
    value: "full-json",
    label: "Full JSON",
    description: "Complete before/after of each object",
  },
  {
    value: "llm",
    label: "LLM formatted minimal diffs",
    description: "XML-wrapped diff with context per entity",
  },
  {
    value: "llm-full",
    label: "LLM formatted full context",
    description: "XML diff + complete before/after per entity",
  },
];

// Whole before/after object of a top-level entity (e.g. the feature revision).
export type RawEntity = { before: unknown; after: unknown; title?: string };

export type DiffCopyInput = {
  // Identifies the change-set as a whole (e.g. the feature key).
  entityName: string;
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
// primary object) plus any supplemental entities carried in `diffs`.
type WholeEntity = { title: string; before: string; after: string };

function collectWholeEntities({
  entityName,
  diffs,
  raw,
}: DiffCopyInput): WholeEntity[] {
  const entities: WholeEntity[] = [];
  if (raw) {
    const before = toJson(raw.before);
    const after = toJson(raw.after);
    if (before !== after) {
      entities.push({ title: raw.title ?? entityName, before, after });
    }
  } else {
    // No whole-shape available — treat each non-supplemental field diff as its
    // own entity so nothing is lost.
    for (const d of diffs.filter((d) => !d.supplemental)) {
      entities.push({ title: d.title, before: d.a, after: d.b });
    }
  }
  for (const d of diffs.filter((d) => d.supplemental)) {
    entities.push({ title: d.title, before: d.a, after: d.b });
  }
  return entities;
}

// Fallback for "Formatted changes" when the rendered detail isn't available
// (the UI prefers the on-screen formatted render's text): a grouped,
// plain-language list of changes derived from the diff badges.
export function buildSummary({ entityName, diffs }: DiffCopyInput): string {
  if (diffs.length === 0) return `No changes to "${entityName}".`;

  const lines: string[] = [`Changes to "${entityName}":`, ""];
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

// ── "Minimal JSON diff": unified diff of just the changed fields ─────────────
export function buildMinimalJsonDiff({
  entityName,
  diffs,
}: DiffCopyInput): string {
  if (diffs.length === 0) return `No changes to "${entityName}".`;
  const patches = diffs.map((d) =>
    createPatch(
      d.title,
      ensureTrailingNewline(d.a),
      ensureTrailingNewline(d.b),
      "before",
      "after",
    ).trim(),
  );
  return [`Minimal JSON diff for "${entityName}"`, "", ...patches].join("\n\n");
}

// ── "Full JSON": the complete before/after object of every entity ────────────
export function buildFullJson(input: DiffCopyInput): string {
  const entities = collectWholeEntities(input);
  if (entities.length === 0) return `No changes to "${input.entityName}".`;
  const blocks = entities.map((e) =>
    [
      `=== ${e.title} ===`,
      "--- before ---",
      e.before.trim() || "(none)",
      "--- after ---",
      e.after.trim() || "(none)",
    ].join("\n"),
  );
  return [`Full JSON for "${input.entityName}"`, "", ...blocks].join("\n\n");
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

// PascalCase, alphanumeric-only tag name derived from an entity title. The
// original title is preserved verbatim in a `title="…"` attribute.
function toTagName(title: string): string {
  const pascal = title
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
  return pascal || "Entity";
}

// `includeObjects` toggles between the lean diff-focused payload (just a
// contextual +/- diff per entity) and the full deep-dive payload that also
// embeds the complete before/after objects.
export function buildLLMDiff(
  input: DiffCopyInput,
  { includeObjects = false }: { includeObjects?: boolean } = {},
): string {
  const { entityName, diffs } = input;
  const entities = collectWholeEntities(input);

  const summary =
    diffs.length > 0
      ? diffs.map((d) => `  - ${d.title}`).join("\n")
      : "  - (no changes)";

  const parts: string[] = [
    `<change-set entity="${escapeAttr(entityName)}">`,
    "<summary>",
    summary,
    "</summary>",
  ];

  for (const e of entities) {
    const tag = toTagName(e.title);
    // A unified +/- diff with surrounding context so the change is obvious at a
    // glance without needing to diff two large blobs by hand.
    parts.push(
      "",
      `<${tag} title="${escapeAttr(e.title)}">`,
      "<diff>",
      unifiedDiffBody(e.title, e.before, e.after) || "(no textual diff)",
      "</diff>",
    );
    // Deep-dive only: the complete objects for exhaustive reasoning.
    if (includeObjects) {
      parts.push(
        "<before>",
        e.before.trim() || "(none)",
        "</before>",
        "<after>",
        e.after.trim() || "(none)",
        "</after>",
      );
    }
    parts.push(`</${tag}>`);
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
      return buildLLMDiff(input, { includeObjects: false });
    case "llm-full":
      return buildLLMDiff(input, { includeObjects: true });
  }
}
