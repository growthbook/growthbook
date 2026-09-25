import { format } from "date-fns";

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

/**
 * The row's timestamp at the precision the data has. With a sub-second part in
 * the raw value, milliseconds are shown; without one, the format is exactly the
 * one the stream has always used — never padded to a ".000" that would claim
 * precision the warehouse did not store.
 */
export function formatStreamTimestamp(raw: unknown, date: Date): string {
  const hasSubSecond = typeof raw === "string" && /:\d{2}[.,]\d+/.test(raw);
  if (!hasSubSecond) return format(date, "PPpp");
  return `${format(date, "PP")}, ${format(date, "h:mm:ss.SSS a")}`;
}
