import type { InterleavingMetricResult } from "shared/validators";
import type { SnapshotMetric } from "shared/types/experiment-snapshot";

/** Control then treatment, in ResultsTable's per-variation shape. */
export function interleavingResultToSnapshotMetrics(
  r: InterleavingMetricResult,
): [SnapshotMetric, SnapshotMetric] {
  const { test } = r;
  return [
    { value: r.control.value, cr: r.control.cr, users: r.users },
    {
      value: r.treatment.value,
      cr: r.treatment.cr,
      users: r.users,
      expected: test.expected,
      ci: [test.ci[0] ?? -Infinity, test.ci[1] ?? Infinity],
      pValue: test.pValue ?? undefined,
      uplift: test.uplift,
      errorMessage: test.errorMessage ?? undefined,
    },
  ];
}
