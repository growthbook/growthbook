// See contextual-bandit-fix-prompt.md for the v1 scope and the v1.5 holdout TODOs.
//
// SMITH: this module is the Python-stats integration seam for the contextual
// bandit pipeline. `runContextualStatsEngine` is the *only* function the
// query runner calls into here; its signature must stay stable so Luke's A5
// can swap the body for a real Python invocation without touching callers.
// Any growth in the `ContextualBanditResult` shape MUST also be reflected in
// `contextResultValidator` / `cbTreeValidator` in
// shared/src/validators/contextual-bandit-event.ts — otherwise the CBE
// create in `persistContextualBanditEvent` will fail schema validation. This
// validator-coupling rule was originally written against the legacy
// `banditIsContextual` flag; under the new `experimentType ===
// "contextual-bandit"` discriminator the rule is unchanged.
// `mockFit` exists only to make orchestrator + runner tests deterministic
// while A5 is in flight and should be deleted at integration time.
import { ContextResult } from "shared/validators";
import { ContextualBanditRow } from "./contextualBanditSql";

export type ContextualBanditSettingsForStatsEngine = {
  var_names: string[];
  var_ids: string[];
  reweight: boolean;
  bandit_weights_seed: number;
  contextual_attributes: string[];
  current_weights_by_context: Record<string, number[]>;
  max_leaves: number;
  min_users_per_leaf: number;
  tree_model: "regression_tree" | "linear_thompson";
};

export type ContextualBanditResult = {
  tree: {
    model: string;
    splitFeatures: string[];
    leaves: { contextId: string; weights: number[] }[];
  };
  contextResults: ContextResult[];
  weightsWereUpdated: boolean;
  updateMessage: string;
  error?: string;
};

// SMITH: replace this body with the real Python stats-engine invocation.
//   Input shape:  (ContextualBanditSettingsForStatsEngine, ContextualBanditRow[])
//   Output shape: ContextualBanditResult — tree + per-context results +
//                 updatedWeights. New output fields require a paired update
//                 to the validators in shared/src/validators/contextual-bandit-event.ts.
// Keep the function signature stable; `ContextualBanditResultsQueryRunner`
// awaits this exact tuple from inside its `runAnalysis` method.
//
// TODO(holdout-v1.5): when the holdout pipeline ships, ContextualBanditResult
// needs a `holdoutComparison` field — probably a struct with sample sizes,
// effect estimate, and an EDF-style decision flag — and the validators in
// shared/src/validators/contextual-bandit-event.ts must mirror the new shape
// in lockstep (per the SMITH rule above) so `persistContextualBanditEvent`
// doesn't fail Zod validation. See contextual-bandit-fix-prompt.md.
export async function runContextualStatsEngine(
  settings: ContextualBanditSettingsForStatsEngine,
  rows: ContextualBanditRow[],
): Promise<ContextualBanditResult> {
  if (process.env.GROWTHBOOK_CB_MOCK_STATS !== "0") {
    return mockFit(settings, rows);
  }
  // Luke's branch swaps this body for the real Python-call invocation
  throw new Error("Real contextual stats engine not yet implemented");
}

// SMITH: delete this whole function once `runContextualStatsEngine` calls
// the real Python stats engine. The single-leaf catch-all fit it produces
// is intentionally not representative of any real tree; it's only here so
// downstream code paths (CBE persistence, payload refresh, SDK threading)
// can be exercised against deterministic output.
function mockFit(
  settings: ContextualBanditSettingsForStatsEngine,
  rows: ContextualBanditRow[],
): ContextualBanditResult {
  // Bucket all rows into a single "catch-all" leaf and compute simple
  // posterior-mean weights (Thompson on aggregate).
  const numVar = settings.var_names.length;
  const sumByVar = Array(numVar).fill(0) as number[];
  const nByVar = Array(numVar).fill(0) as number[];

  rows.forEach((r) => {
    const v = Number(r.variation);
    if (v >= 0 && v < numVar) {
      sumByVar[v] += r.main_sum;
      nByVar[v] += r.n;
    }
  });

  const means = sumByVar.map((s, i) => (nByVar[i] ? s / nByVar[i] : 0));
  const expMeans = means.map((m) => Math.exp(m * 100));
  const total = expMeans.reduce((a, b) => a + b, 0) || 1;
  const weights = expMeans.map((e) => e / total);

  const leafContextId = "ctx_catchall";
  return {
    tree: {
      model: "mock_catch_all",
      splitFeatures: [],
      leaves: [{ contextId: leafContextId, weights }],
    },
    contextResults: [
      {
        contextId: leafContextId,
        sampleSizePerVariation: nByVar,
        variationMeans: means,
        updatedWeights: weights,
        bestArmProbabilities: weights,
        updateMessage: "Mock fitter: single catch-all leaf",
      },
    ],
    weightsWereUpdated: true,
    updateMessage: "Mock fitter ran on stub rows",
  };
}
