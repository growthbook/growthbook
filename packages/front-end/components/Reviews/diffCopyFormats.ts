import { createPatch } from "diff";
import {
  buildFullJson as buildFullJsonShared,
  buildMinimalJsonDiff as buildMinimalJsonDiffShared,
  type DiffCopyInput as SharedDiffCopyInput,
  type RawEntity,
} from "shared/util";
export type { RawEntity } from "shared/util";

// Entity-agnostic diff section — any entity adapter that produces sections
// matching this shape can reuse the copy/export infrastructure.
export interface DiffSection {
  title: string;
  key?: string;
  a: string;
  b: string;
  supplemental?: boolean;
  entityName?: string;
  entityType?: string;
  badges?: { label: string; action?: string }[];
}

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

// Front-end facing input: same shape as the shared one, but typed against the
// entity-agnostic DiffSection (which is structurally compatible with the richer
// FeatureRevisionDiff). `buildSummary` / `buildLLMDiff` use the React-free
// fields (title, a, b, badges) directly; the JSON formats delegate to shared.
export type DiffCopyInput = {
  entityName: string;
  entityType?: string;
  diffs: DiffSection[];
  raw?: RawEntity;
};

// FE diffs include `node` (ReactNode) and `badges` that the shared format
// doesn't know about; strip them so the shared helpers see only their typed
// subset.
function toSharedInput(input: DiffCopyInput): SharedDiffCopyInput {
  return {
    entityName: input.entityName,
    entityType: input.entityType,
    raw: input.raw,
    diffs: input.diffs.map(
      ({ title, a, b, entityName, entityType, supplemental }) => ({
        title,
        a,
        b,
        ...(entityName !== undefined ? { entityName } : {}),
        ...(entityType !== undefined ? { entityType } : {}),
        ...(supplemental !== undefined ? { supplemental } : {}),
      }),
    ),
  };
}

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

// The two JSON formats live in shared (so the back-end REST API can return
// the same shapes). The front-end just adapts its richer DiffCopyInput down
// to the shared input before delegating.
export function buildMinimalJsonDiff(input: DiffCopyInput): string {
  return buildMinimalJsonDiffShared(toSharedInput(input));
}

export function buildFullJson(input: DiffCopyInput): string {
  return buildFullJsonShared(toSharedInput(input));
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
