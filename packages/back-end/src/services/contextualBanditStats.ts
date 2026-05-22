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
