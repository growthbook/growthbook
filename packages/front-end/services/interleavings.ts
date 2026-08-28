import { ApiInterleavingInterface } from "shared/validators";
import { ExperimentDataForStatusStringDates } from "shared/types/experiment";

/**
 * Adapts an interleaving experiment into the experiment-shaped data
 * `ExperimentStatusIndicator` expects, so interleaving renders the exact same
 * status badge as experiments (contextual-bandit pattern). Interleavings lack
 * several experiment fields, so supply harmless defaults for the indicator.
 */
export function interleavingStatusIndicatorData(
  il: ApiInterleavingInterface,
): ExperimentDataForStatusStringDates {
  return {
    type: "standard",
    variations: il.variationNames.map((name, i) => ({
      id: String(i),
      key: String(i),
      name,
      description: "",
      screenshots: [],
    })),
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
        coverage: 1,
        condition: "",
        variationWeights: [0.5, 0.5],
        variations: [{ id: "0" }, { id: "1" }],
      },
    ],
    dismissedWarnings: [],
    goalMetrics: il.metrics.map((m) => m.id),
    secondaryMetrics: [],
    guardrailMetrics: [],
    datasource: il.datasource,
    decisionFrameworkSettings: {},
    nextScheduledStatusUpdate: null,
  } as unknown as ExperimentDataForStatusStringDates;
}
