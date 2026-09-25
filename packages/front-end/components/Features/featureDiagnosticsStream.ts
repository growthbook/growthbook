import { format } from "date-fns";
import { stemRuleId } from "shared/util";
import { getValidDate } from "shared/dates";
import type { FeatureRule } from "shared/types/feature";

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
 * The managed warehouse's table columns, in display order, after Timestamp.
 * Its projection is fixed (ClickHouse#getFeatureEvalDiagnosticsQuery), so the
 * set is known without reading the rows.
 */
export const MANAGED_STREAM_TABLE_COLUMNS = [
  "environment",
  "value",
  "source",
  "ruleId",
];

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

export interface StreamTimestampPlan {
  /** A row's timestamp, at the precision its raw value has. */
  format: (raw: unknown, date: Date) => string;
  /** The one date every row shares, for the header; null when they differ. */
  headerDate: string | null;
  /** Wide enough that no timestamp in the set truncates. */
  width: number;
}

/**
 * How the Timestamp column renders, decided ONCE from the whole fetched result
 * set — the same rule as the User ID and Variation gates — so it holds still
 * while paging and changes only when the query re-runs.
 *
 * Never truncates: the column is sized to the longest string in the set. Parts
 * are dropped from least informative first: all rows on one calendar day show
 * time only, with the date stated once in the header; one year but several
 * days drops the year; several years keep everything (the format the stream
 * always used). Milliseconds only when the raw value has a sub-second part —
 * never padded to a ".000" that would claim precision the data does not have.
 */
export function planStreamTimestamps(
  rows: { timestamp: unknown }[],
): StreamTimestampPlan {
  const dates = rows.map((r) => getValidDate(r.timestamp as string));
  const sameDay = new Set(dates.map((d) => format(d, "yyyy-MM-dd"))).size <= 1;
  const sameYear = new Set(dates.map((d) => d.getFullYear())).size <= 1;

  const time = (raw: unknown, date: Date) =>
    format(date, hasSubSecond(raw) ? "h:mm:ss.SSS a" : "h:mm:ss a");
  const formatRow = (raw: unknown, date: Date) =>
    sameDay
      ? time(raw, date)
      : sameYear
        ? `${format(date, "MMM d")}, ${time(raw, date)}`
        : `${format(date, "PP")}, ${time(raw, date)}`;

  const headerDate = sameDay && dates.length ? format(dates[0], "PP") : null;

  if (!rows.length) {
    return { format: formatRow, headerDate, width: EMPTY_TIMESTAMP_WIDTH };
  }
  const longest = Math.max(
    ...rows.map((r, i) => formatRow(r.timestamp, dates[i]).length),
  );
  const header = timestampHeader(headerDate);
  const width = Math.ceil(
    Math.max(
      longest * MONO_CHAR_PX + CELL_PADDING_PX,
      header.length * HEADER_CHAR_PX + HEADER_ICON_PX + CELL_PADDING_PX,
    ),
  );
  return { format: formatRow, headerDate, width };
}

/** The Timestamp header, carrying the shared date when there is one. */
export function timestampHeader(headerDate: string | null): string {
  return headerDate ? `Timestamp · ${headerDate}` : "Timestamp";
}

/**
 * Names a row's variation from the flag's current config: "0 · Control". The
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
    return name ? `${variationId} · ${name}` : variationId;
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
