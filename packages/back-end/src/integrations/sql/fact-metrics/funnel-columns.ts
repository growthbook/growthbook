/**
 * Column names for a funnel metric's block in the inline experiment query.
 *
 * A funnel occupies a single metric slot but, unlike every other metric type,
 * emits one column per step rather than a fixed set. These helpers are the
 * single source of truth for those names across the SQL builders, the row
 * parser, and the stats-engine packaging layer that splits the block into
 * per-step binomial metrics.
 *
 * `alias` is the metric's slot alias (`m0`, `m1`, ...), the same prefix the
 * non-funnel columns like `m0_value` use.
 */

/** Per-event: the row's timestamp when it matches step k's filters. */
export function funnelStepTimestampColumn(
  alias: string,
  stepIndex: number,
): string {
  return `${alias}_step_${stepIndex}_ts`;
}

/** Per-unit: step k's matching timestamps, sorted ascending. */
export function funnelStepArrayColumn(
  alias: string,
  stepIndex: number,
): string {
  return `${alias}_step_${stepIndex}_arr`;
}

/** Per-unit: the timestamp at which the unit completed step k, if it did. */
export function funnelStepResolvedTsColumn(
  alias: string,
  stepIndex: number,
): string {
  return `${alias}_step_${stepIndex}_resolved_ts`;
}

/** Per-unit: 1 if the unit reached step k, else 0. */
export function funnelStepValueColumn(
  alias: string,
  stepIndex: number,
): string {
  return `${alias}_step_${stepIndex}_value`;
}

/** Per variation/dimension: how many units reached step k. */
export function funnelStepSumColumn(alias: string, stepIndex: number): string {
  return `${alias}_step_${stepIndex}_sum`;
}

const FUNNEL_STEP_SUM_COLUMN_RE = /^(m\d+)_step_(\d+)_sum$/;

export function parseFunnelStepSumColumn(
  column: string,
): { alias: string; stepIndex: number } | null {
  const match = column.match(FUNNEL_STEP_SUM_COLUMN_RE);
  if (!match) return null;
  return { alias: match[1], stepIndex: parseInt(match[2], 10) };
}
