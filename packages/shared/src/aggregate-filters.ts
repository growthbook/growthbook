/**
 * Aggregate filters limit a unit's total of a fact table column, such as
 * ">=3" or ">=3,<10": comma-separated comparisons against a number, with
 * whitespace ignored.
 */
export type AggregateFilterCondition = { operator: string; value: string };

const AGGREGATE_CONDITION_REGEX = /^(=|!=|<>|<=|<|>=|>)(\d+(\.\d+)?)$/;

// Empty parts are skipped, so ">=3," and " " parse without an invalid entry.
export function parseAggregateFilter(aggregateFilter: string): {
  conditions: AggregateFilterCondition[];
  invalid: string[];
} {
  const conditions: AggregateFilterCondition[] = [];
  const invalid: string[] = [];
  for (const part of aggregateFilter.replace(/\s*/g, "").split(",")) {
    if (!part) continue;
    const match = part.match(AGGREGATE_CONDITION_REGEX);
    if (match) {
      conditions.push({ operator: match[1], value: match[2] });
    } else {
      invalid.push(part);
    }
  }
  return { conditions, invalid };
}
