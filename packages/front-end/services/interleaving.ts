import type {
  ApiInterleavingInterface,
  InterleavingAnalysis,
  InterleavingMetricResult,
} from "shared/validators";
import { interleavingVariationsList } from "shared/util";
import type { SnapshotMetric } from "shared/types/experiment-snapshot";
import type { ExperimentDataForStatusStringDates } from "shared/types/experiment";
import type { GrowthBook } from "@growthbook/growthbook-react";
import type { AppFeatures } from "shared/types/app-features";
import { envEnablesInterleaving } from "@/services/env";

// The remote flag never evaluates true for self-hosted installs, so the
// ENABLE_INTERLEAVING env var is the fallback there. Every UI gate goes
// through here so retiring the flag later is a one-line change.
export function isInterleavingEnabled(
  gb: GrowthBook<AppFeatures> | undefined,
): boolean {
  return envEnablesInterleaving() || !!gb?.isOn("interleave-exp");
}

// Shared so the results sections, the overview card and the analysis picker
// can't drift on what an analysis type is called.
export const INTERLEAVING_ANALYSIS_TITLES: Record<
  InterleavingAnalysis["type"],
  string
> = {
  paired: "Paired",
  preference: "Preference",
};

export function interleavingResultToSnapshotMetrics(
  r: InterleavingMetricResult,
): [SnapshotMetric, SnapshotMetric] {
  const { test } = r;
  const denominator = r.denominator ?? r.users;
  const control = {
    value: r.control.value,
    cr: r.control.cr,
    users: r.users,
    denominator,
  };

  // A failed test has no bounds to draw. ResultsTable only shows the error row
  // for computeFailed with no users, so widening null bounds to +/-Infinity
  // here would draw an invented interval instead.
  if (test.errorMessage) {
    return [
      { ...control, users: 0 },
      {
        value: r.treatment.value,
        cr: r.treatment.cr,
        users: 0,
        denominator,
        errorMessage: test.errorMessage,
        computeFailed: true,
      },
    ];
  }

  return [
    control,
    {
      value: r.treatment.value,
      cr: r.treatment.cr,
      users: r.users,
      denominator,
      expected: test.expected,
      ci: [test.ci[0] ?? -Infinity, test.ci[1] ?? Infinity],
      pValue: test.pValue ?? undefined,
    },
  ];
}

export function interleavingStatusIndicatorData(
  il: Pick<
    ApiInterleavingInterface,
    | "status"
    | "archived"
    | "variations"
    | "datasourceId"
    | "coverage"
    | "condition"
    | "seed"
    | "dateCreated"
    | "dateStarted"
    | "dateStopped"
  >,
): ExperimentDataForStatusStringDates {
  const variations = interleavingVariationsList(il.variations).map((v) => ({
    id: v.id,
  }));
  return {
    type: "interleaving",
    variations,
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
        variationWeights: [0.5, 0.5],
        variations,
        seed: il.seed,
      },
    ],
    dismissedWarnings: [],
    goalMetrics: [],
    secondaryMetrics: [],
    guardrailMetrics: [],
    datasourceId: il.datasourceId,
    decisionFrameworkSettings: {},
    nextScheduledStatusUpdate: null,
  } as unknown as ExperimentDataForStatusStringDates;
}
