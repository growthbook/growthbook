import type {
  ApiInterleavingInterface,
  InterleavingMetricResult,
} from "shared/validators";
import type { SnapshotMetric } from "shared/types/experiment-snapshot";
import type { ExperimentDataForStatusStringDates } from "shared/types/experiment";

export function interleavingResultToSnapshotMetrics(
  r: InterleavingMetricResult,
): [SnapshotMetric, SnapshotMetric] {
  const { test } = r;
  const denominator = r.denominator ?? r.users;
  return [
    { value: r.control.value, cr: r.control.cr, users: r.users, denominator },
    {
      value: r.treatment.value,
      cr: r.treatment.cr,
      users: r.users,
      denominator,
      expected: test.expected,
      ci: [test.ci[0] ?? -Infinity, test.ci[1] ?? Infinity],
      pValue: test.pValue ?? undefined,
      uplift: test.uplift,
      errorMessage: test.errorMessage ?? undefined,
    },
  ];
}

export function interleavingStatusIndicatorData(
  il: Pick<
    ApiInterleavingInterface,
    | "status"
    | "archived"
    | "variations"
    | "datasource"
    | "coverage"
    | "condition"
    | "seed"
    | "dateCreated"
    | "dateStarted"
    | "dateStopped"
  >,
): ExperimentDataForStatusStringDates {
  return {
    type: "interleaving",
    variations: il.variations.map((v) => ({ id: v.id })),
    status: il.status,
    archived: il.archived,
    results: undefined,
    analysisSummary: undefined,
    phases: [
      {
        dateStarted: il.dateStarted ?? il.dateCreated,
        dateEnded: il.dateStopped ?? undefined,
        name: "Main",
        reason: "",
        coverage: il.coverage ?? 1,
        condition: il.condition ?? "",
        variationWeights: il.variations.map(() => 0.5),
        variations: il.variations.map((v) => ({ id: v.id })),
        seed: il.seed,
      },
    ],
    dismissedWarnings: [],
    goalMetrics: [],
    secondaryMetrics: [],
    guardrailMetrics: [],
    datasource: il.datasource,
    decisionFrameworkSettings: {},
    nextScheduledStatusUpdate: null,
  } as unknown as ExperimentDataForStatusStringDates;
}
