import { format } from "date-fns";
import { extractConditionAttributeKeys, stemRuleId } from "shared/util";
import { getValidDate } from "shared/dates";
import type { FeatureRule } from "shared/types/feature";
import type { FeatureUsageRowFilter } from "shared/types/integrations";

/**
 * Header labels for stream columns, keyed lower-case so both spellings a
 * warehouse can return map to one label: the managed warehouse's camelCase
 * (`ruleId`) and the event-forwarder templates' snake_case (`rule_id`), in
 * whatever case the warehouse hands back. A raw column name like "Rule Id" is
 * a database identifier leaking into the UI.
 */
const STREAM_COLUMN_LABELS: Record<string, string> = {
  ruleid: "Rule",
  rule_id: "Rule",
  variationid: "Variation",
  variation_id: "Variation",
  feature_key: "Feature",
  timestamp: "Timestamp",
  environment: "Environment",
  value: "Value",
  source: "Source",
};

/**
 * A column's header. Known fields get their label; anything else — a column a
 * customer's own query added — renders exactly as it always has, title-cased
 * from its snake_case name.
 */
export function streamColumnLabel(key: string): string {
  return (
    STREAM_COLUMN_LABELS[key.toLowerCase()] ??
    key
      .split("_")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(" ")
  );
}

/**
 * Headers for the managed warehouse's own columns, where we own the schema and
 * know what each field means. `unit_id` is its identity column, shown as
 * "User ID". Kept off the generic path, whose headers render the customer's
 * query as it is.
 */
export function managedStreamColumnLabel(key: string): string {
  return key === "unit_id" ? "User ID" : streamColumnLabel(key);
}

/**
 * The managed warehouse's always-on middle columns, in display order: the
 * explanation chain, coarse to fine — what was served, then by which rule. Its projection is fixed
 * (ClickHouse#getFeatureEvalDiagnosticsQuery), so the set is known without
 * reading the rows. User ID leads and Variation and Environment follow; see
 * the columns memo in FeatureDiagnostics.
 */
// Source is hidden. The field is still in every row, but the stream's search
// covers visible columns only, so it no longer matches source values.
export const MANAGED_STREAM_TABLE_COLUMNS = ["value", "ruleId"];

/**
 * One row's timestamp in full — date with year, and milliseconds only when the
 * raw value has them — for the detail drawer, where there is room for it.
 */
export function formatFullStreamTimestamp(raw: unknown): string {
  const date = getValidDate(raw as string);
  return `${format(date, "PP")}, ${format(
    date,
    hasSubSecond(raw) ? "h:mm:ss.SSS a" : "h:mm:ss a",
  )}`;
}

/** Whether a raw timestamp carries a sub-second part. */
function hasSubSecond(raw: unknown): boolean {
  return typeof raw === "string" && /:\d{2}[.,]\d+/.test(raw);
}

/**
 * Character width of the cells' 12px monospace, measured: the old fixed column
 * fit "Sep 21, 2026, 11:59:59 PM" (25 characters) in ~183px.
 */
const MONO_CHAR_PX = 7.32;
/** ui/Table's 12px of cell padding on each side. */
const CELL_PADDING_PX = 24;
/** The header is proportional type plus a sort icon, so it is estimated. */
const HEADER_CHAR_PX = 7;
const HEADER_ICON_PX = 20;
/** Before any rows: the width the fixed column always had. */
const EMPTY_TIMESTAMP_WIDTH = 210;

/**
 * The widest the within-a-year format can render — "Sep 28, 12:59:59.999 PM"
 * — so the Timestamp column is that wide whatever the rows hold and does not
 * resize as filters or the time range change. Only a set spanning years, which
 * adds the year, can need more.
 */
export const STREAM_TIMESTAMP_CH = 23;

export interface StreamTimestampPlan {
  /** A row's timestamp, at the precision its raw value has. */
  format: (raw: unknown, date: Date) => string;
  /** Wide enough that no timestamp in the set truncates. */
  width: number;
}

/**
 * How the Timestamp column renders, decided ONCE from the whole fetched result
 * set — the same rule as the User ID and Variation gates — so it holds still
 * while paging and changes only when the query re-runs.
 *
 * Every cell carries its own date as an abbreviated month and day ("Sep 28,
 * 1:23:45 PM"); the year is added only when the set spans more than one.
 * Milliseconds only when the raw value has a sub-second part — never padded to
 * a ".000" that would claim precision the data does not have. Never truncates:
 * the width covers the longest string in the set.
 */
export function planStreamTimestamps(
  rows: { timestamp: unknown }[],
): StreamTimestampPlan {
  const dates = rows.map((r) => getValidDate(r.timestamp as string));
  const sameYear = new Set(dates.map((d) => d.getFullYear())).size <= 1;

  const time = (raw: unknown, date: Date) =>
    format(date, hasSubSecond(raw) ? "h:mm:ss.SSS a" : "h:mm:ss a");
  const formatRow = (raw: unknown, date: Date) =>
    `${format(date, sameYear ? "MMM d" : "PP")}, ${time(raw, date)}`;

  if (!rows.length) {
    return { format: formatRow, width: EMPTY_TIMESTAMP_WIDTH };
  }
  const longest = Math.max(
    ...rows.map((r, i) => formatRow(r.timestamp, dates[i]).length),
  );
  const width = Math.ceil(
    Math.max(
      Math.max(longest, STREAM_TIMESTAMP_CH) * MONO_CHAR_PX + CELL_PADDING_PX,
      "Timestamp".length * HEADER_CHAR_PX + HEADER_ICON_PX + CELL_PADDING_PX,
    ),
  );
  return { format: formatRow, width };
}

/**
 * Names a row's variation from the flag's current config: "(0) Control". The
 * warehouse value leads, since it is what the row actually holds.
 *
 * Matched the way the payload builder keys them (back-end util/features.ts):
 * an experiment-ref by the experiment's variation key, a legacy inline
 * experiment by index, a safe rollout as "0" Control / "1" Variation. With no
 * match in the current config — the rule is gone, the flag was edited since
 * the row was served, or the rule type carries no names (a monitored rollout)
 * — the bare value, never a guessed or positional name.
 */
export function buildVariationLabeler(
  rules: FeatureRule[],
  experimentsById: Map<string, { variations: { key: string; name: string }[] }>,
): (ruleId: string, variationId: string) => string {
  const rulesByStem = new Map<string, FeatureRule>();
  rules.forEach((rule) => {
    if (rule.id) rulesByStem.set(stemRuleId(rule.id), rule);
  });

  const nameFor = (rule: FeatureRule, variationId: string) => {
    if (rule.type === "experiment-ref") {
      return experimentsById
        .get(rule.experimentId)
        ?.variations.find((v) => v.key === variationId)?.name;
    }
    if (rule.type === "experiment") {
      return /^\d+$/.test(variationId)
        ? rule.values[Number(variationId)]?.name
        : undefined;
    }
    if (rule.type === "safe-rollout") {
      return { "0": "Control", "1": "Variation" }[variationId];
    }
    return undefined;
  };

  return (ruleId, variationId) => {
    if (!variationId) return variationId;
    const rule = rulesByStem.get(stemRuleId(ruleId));
    const name = rule ? nameFor(rule, variationId)?.trim() : undefined;
    return name ? `(${variationId}) ${name}` : variationId;
  };
}

/**
 * Why a row has no rule, for the Rule cell's muted dash — or null when it has
 * one. "$default" is what the SDK writes when the default value was served; ""
 * is a result that bypassed rules entirely (an override, a prerequisite).
 */
export function ruleAbsenceNote(ruleId: string): string | null {
  if (ruleId === "$default") {
    return "No rule matched — the flag's default value was served.";
  }
  if (ruleId === "") return "Served without a rule.";
  return null;
}

/**
 * A header label's width in the cells' `ch`. Headers are 11px uppercase with
 * 0.06em tracking in the UI font, so an uppercase glyph runs ~1.15 of the
 * 12px monospace `ch`; the sort control adds ~2ch. An estimate from type
 * metrics, not a measurement — it only has to keep the header from clipping.
 */
function headerCh(label: string): number {
  return Math.ceil(label.length * 1.15 + 2);
}

/**
 * Breathing room added to a column's content width, in px. At exact content
 * width the columns sat tight against their neighbours.
 */
export const STREAM_COLUMN_EXTRA_PX: Record<string, number> = {
  timestamp: 14,
  unit_id: 14,
  value: 28,
  ruleId: 14,
  variationId: 28,
};

/** Per-column bounds in `ch`. */
const COLUMN_BOUNDS: Record<string, { min: number; max: number }> = {
  // Fixed at the format's widest (see STREAM_TIMESTAMP_CH), not the rows'.
  timestamp: { min: STREAM_TIMESTAMP_CH, max: Infinity },
  unit_id: { min: 14, max: 28 },
  value: { min: 8, max: 24 },
  variationId: { min: 0, max: 24 },
  environment: { min: 0, max: 24 },
  ruleId: { min: 24, max: 48 },
};

/**
 * Column widths in `ch` for the managed stream, decided once from the full
 * fetched result set like the other gates, so they hold still while paging.
 *
 * Each column is sized to its widest value, never below its header, clamped
 * to its bounds — Rule's are 24–48ch. The table stays full width: whatever the
 * columns leave over goes to an empty trailing column rather than opening a
 * gap inside Rule.
 */
export function planStreamColumnWidths(
  keys: string[],
  rows: Record<string, unknown>[],
  label: (key: string) => string,
  /** What a cell actually renders, where that is not its raw value. */
  text: (key: string, row: Record<string, unknown>) => string = (key, row) =>
    String(row[key] ?? ""),
): Record<string, number> {
  const widths: Record<string, number> = {};
  keys.forEach((key) => {
    const header = headerCh(label(key));
    const content = Math.max(0, ...rows.map((row) => text(key, row).length));
    const { min, max } = COLUMN_BOUNDS[key] ?? { min: 0, max: Infinity };
    widths[key] = Math.min(
      Math.max(content, header, min),
      Math.max(max, header),
    );
  });
  return widths;
}

/**
 * Attribute keys referenced by a targeting condition on any of the flag's
 * rules in `environment` (all rules when the row has none), in rule order.
 * Read from the flag's CURRENT config: this says a rule looks at the
 * attribute, not that it decided this row's outcome.
 *
 * Conditions are parsed with the shared extractConditionAttributeKeys, the
 * same walker the attribute registration check uses. Saved-group targeting is
 * not included — only the condition itself.
 */
export function targetingAttributeKeys(
  rules: FeatureRule[],
  environment: string | null,
): string[] {
  const keys: string[] = [];
  rules.forEach((rule) => {
    const inEnvironment =
      !environment ||
      rule.allEnvironments ||
      (rule.environments ?? []).includes(environment);
    if (!inEnvironment || !rule.condition) return;
    try {
      extractConditionAttributeKeys(JSON.parse(rule.condition)).forEach(
        (key) => {
          if (!keys.includes(key)) keys.push(key);
        },
      );
    } catch {
      // An unparseable condition references nothing we can name.
    }
  });
  return keys;
}

/** Whether a condition key refers to this attribute ("user.id" -> "user"). */
function refersTo(conditionKey: string, attribute: string): boolean {
  return conditionKey === attribute || conditionKey.startsWith(`${attribute}.`);
}

/**
 * The drawer's attributes split by whether a rule's condition references them.
 * Null when no condition references anything, so the caller renders the flat
 * list as before. Both groups keep the SDK's order; condition keys the SDK did
 * not send are listed as `absent` — a missing attribute is usually why a
 * condition failed.
 */
export function groupAttributesByTargeting(
  attributes: [string, unknown][],
  targetingKeys: string[],
): {
  targeted: [string, unknown][];
  absent: string[];
  other: [string, unknown][];
} | null {
  if (!targetingKeys.length) return null;
  const isTargeted = (key: string) =>
    targetingKeys.some((t) => refersTo(t, key));
  return {
    targeted: attributes.filter(([key]) => isTargeted(key)),
    absent: targetingKeys.filter(
      (t) => !attributes.some(([key]) => refersTo(t, key)),
    ),
    other: attributes.filter(([key]) => !isTargeted(key)),
  };
}

const ROW_FILTER_COLUMNS = new Set<string>([
  "value",
  "ruleId",
  "source",
  "variationId",
]);
const ROW_FILTER_OPERATORS = new Set<string>([
  "=",
  "!=",
  "in",
  "not_in",
  "starts_with",
  "ends_with",
  "contains",
  "not_contains",
  "is_null",
  "not_null",
]);
const NULL_OPERATORS = new Set<string>(["is_null", "not_null"]);

/**
 * The builder's committed filters in the server's shape. A filter still being
 * built (no column, or no value where one is needed) has not been applied and
 * is left out. Anything else is passed through as-is — including a column or
 * operator outside the whitelist — so the server rejects it loudly rather
 * than the client dropping it quietly.
 */
export function toUsageRowFilters(
  filters: { column?: string; operator: string; values?: string[] }[],
): FeatureUsageRowFilter[] {
  return filters
    .filter((f) => {
      if (!f.column) return false;
      if (NULL_OPERATORS.has(f.operator)) return true;
      return (f.values ?? []).some((v) => v !== "");
    })
    .map((f) => ({
      column: f.column as FeatureUsageRowFilter["column"],
      operator: f.operator as FeatureUsageRowFilter["operator"],
      values: NULL_OPERATORS.has(f.operator)
        ? []
        : (f.values ?? []).filter((v) => v !== ""),
    }));
}

/** Whether a filter names a column and operator the server accepts. */
export function isSupportedUsageRowFilter(f: FeatureUsageRowFilter): boolean {
  return (
    ROW_FILTER_COLUMNS.has(f.column) && ROW_FILTER_OPERATORS.has(f.operator)
  );
}

/**
 * The server's semantics, client-side, for data that never reaches it (the
 * dummy fixture) and for deciding which breakdown rows fall outside a filter.
 * Stored text, no coercion; on the rule column is_null / not_null mean empty /
 * non-empty, as the server maps them.
 */
export function matchesUsageRowFilter(
  value: string | null | undefined,
  filter: FeatureUsageRowFilter,
): boolean {
  const v = value ?? "";
  const first = filter.values[0] ?? "";
  switch (filter.operator) {
    case "=":
      return v === first;
    case "!=":
      return v !== first;
    case "in":
      return filter.values.includes(v);
    case "not_in":
      return !filter.values.includes(v);
    case "starts_with":
      return v.startsWith(first);
    case "ends_with":
      return v.endsWith(first);
    case "contains":
      return v.includes(first);
    case "not_contains":
      return !v.includes(first);
    case "is_null":
      return filter.column === "ruleId"
        ? v === ""
        : value === null || value === undefined;
    case "not_null":
      return filter.column === "ruleId"
        ? v !== ""
        : value !== null && value !== undefined;
  }
}
