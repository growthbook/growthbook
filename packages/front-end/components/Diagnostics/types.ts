import { ReactNode } from "react";

export interface RecordsColumn<T> {
  /** Stable identity, and the default row field this column consumes. */
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  width?: string;
}

export interface TimeRangeOption {
  label: string;
  hours: number;
}

// Must stay within MAX_RECORDS_WINDOW_HOURS (24 * 7) in
// back-end/src/routers/experiment-exposures/experiment-exposures.controller.ts
// — a longer range is rejected with a 400.
export const DEFAULT_TIME_RANGES: TimeRangeOption[] = [
  { label: "Last 1 hour", hours: 1 },
  { label: "Last 6 hours", hours: 6 },
  { label: "Last 24 hours", hours: 24 },
  { label: "Last 7 days", hours: 168 },
];

export interface RecordsFilterOption {
  /** Matches SearchFiltersItem so a dropdown can render a rich label. */
  name: string | JSX.Element;
  id: string;
  searchValue: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Date)
  );
}

/**
 * The whole record as one flat object, for the expanded detail view. Fields
 * already shown as columns are kept — the detail is the complete record, not
 * a leftovers bag.
 *
 * `flattenKeys` names nested objects whose entries are lifted to the top level,
 * so grouping wrappers like `dimensions` don't show up as nested blobs.
 */
export function flattenRecord<T extends object>(
  row: T,
  options?: { flattenKeys?: string[] },
): Record<string, unknown> {
  const flattenKeys = new Set(options?.flattenKeys ?? []);
  const flattened: Record<string, unknown> = {};
  const lifted: [string, string, unknown][] = [];

  // Top-level fields first, so a lifted child can never overwrite one. A
  // warehouse column called "userId" must not replace the normalized value.
  for (const [key, value] of Object.entries(row)) {
    if (flattenKeys.has(key) && isPlainObject(value)) {
      for (const [childKey, childValue] of Object.entries(value)) {
        lifted.push([key, childKey, childValue]);
      }
      continue;
    }
    flattened[key] = value;
  }

  // A child whose name is already taken keeps its wrapper as a qualifier, so
  // both values stay visible and their origin is obvious.
  for (const [parentKey, childKey, childValue] of lifted) {
    const key = childKey in flattened ? `${parentKey}.${childKey}` : childKey;
    flattened[key] = childValue;
  }

  return flattened;
}
