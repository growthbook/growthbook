// See contextual-bandit-fix-prompt.md for the v1 scope and the v1.5 holdout TODOs.
import {
  contextualBanditAttrCol,
  ExperimentMetricInterface,
} from "shared/experiments";
import { ExperimentMetricQueryResponseRows } from "shared/types/integrations";
import {
  ExperimentSnapshotAnalysisSettings,
  ExperimentSnapshotSettings,
} from "shared/types/experiment-snapshot";
import type {
  ContextualBanditSettingsForStatsEngine as PythonContextualBanditSettings,
  ContextualBanditSnapshot,
} from "shared/types/stats";
import { logger } from "back-end/src/util/logger";
import {
  getAnalysisSettingsForStatsEngine,
  getMetricSettingsForStatsEngine,
  runStatsEngine,
} from "back-end/src/services/stats";

export type ContextualBanditSettingsForStatsEngine = {
  var_names: string[];
  var_ids: string[];
  reweight: boolean;
  bandit_weights_seed: number;
  contextual_attributes: string[];
  current_weights_by_context: Record<string, number[]>;
  max_leaves: number;
  min_users_per_leaf: number;
};

/** Mirrors gbstats `ContextualBanditResult` (per-context responses + optional tree leaf_map). */
export type ContextualBanditResult = ContextualBanditSnapshot;

export type RunContextualStatsEngineOptions = {
  snapshotId: string;
  sql?: string;
  decisionMetricId: string;
  snapshotSettings: ExperimentSnapshotSettings;
  analysisSettings: ExperimentSnapshotAnalysisSettings;
  metricMap: Map<string, ExperimentMetricInterface>;
  variations: { id: string; name: string; weight: number }[];
  coverage: number;
  phaseLengthDays: number;
};

/** SQL rows often use variation keys (`"0"`, `"1"`); gbstats expects variation ids. */
export function canonicalizeVariationIdsInRows(
  rows: ExperimentMetricQueryResponseRows,
  varIds: string[],
): ExperimentMetricQueryResponseRows {
  return rows.map((row) => {
    const idx = variationIndexFromRow(row, varIds);
    if (idx === null) {
      return row;
    }
    return { ...row, variation: varIds[idx] };
  });
}

export async function runContextualStatsEngine(
  settings: ContextualBanditSettingsForStatsEngine,
  rows: ExperimentMetricQueryResponseRows,
  runParams?: RunContextualStatsEngineOptions,
): Promise<ContextualBanditResult> {
  const normalizedRows = canonicalizeVariationIdsInRows(
    prepareRowsForContextualStats(rows),
    settings.var_ids,
  );
  // Mock is opt-in only (tests / dev without the stats engine). Default path
  // calls the Python contextual tree bandit in gbstats.
  if (process.env.GROWTHBOOK_CB_MOCK_STATS === "1") {
    return mockFit(settings, normalizedRows);
  }
  if (!runParams) {
    throw new Error(
      "Contextual stats engine requires runParams when mock stats are disabled",
    );
  }
  return runContextualStatsEngineWithPython(
    settings,
    normalizedRows,
    runParams,
  );
}

function stripInternalRowFields(
  rows: ExperimentMetricQueryResponseRows,
): ExperimentMetricQueryResponseRows {
  return rows.map((row) => {
    const { contextId, ...rest } = row as typeof row & { contextId?: string };
    void contextId;
    return rest;
  });
}

/** Mirrors gbstats `filter_query_rows` — strips `m0_*` fact-metric columns to `main_sum`, etc. */
export function filterMetricQueryRowsForStatsEngine(
  rows: ExperimentMetricQueryResponseRows,
  metricIndex = 0,
): ExperimentMetricQueryResponseRows {
  const prefix = `m${metricIndex}_`;
  const otherMetricPrefix = /^m\d+_/;
  return rows.map((row) => {
    const out: Record<string, string | number> = {};
    for (const [k, v] of Object.entries(row)) {
      if (k.startsWith(prefix)) {
        out[k.slice(prefix.length)] = v as string | number;
      } else if (!otherMetricPrefix.test(k)) {
        out[k] = v as string | number;
      }
    }
    return out as ExperimentMetricQueryResponseRows[number];
  });
}

function isFactMetricQueryRow(
  row: ExperimentMetricQueryResponseRows[number],
): boolean {
  return `m0_id` in row;
}

export function prepareRowsForContextualStats(
  rows: ExperimentMetricQueryResponseRows,
): ExperimentMetricQueryResponseRows {
  const withoutInternal = stripInternalRowFields(rows);
  if (withoutInternal.length > 0 && isFactMetricQueryRow(withoutInternal[0])) {
    return filterMetricQueryRowsForStatsEngine(withoutInternal, 0);
  }
  return withoutInternal;
}

function variationIndexFromRow(
  row: ExperimentMetricQueryResponseRows[number],
  varIds: string[],
): number | null {
  const key = String(row.variation ?? "");
  const byId = varIds.indexOf(key);
  if (byId >= 0) {
    return byId;
  }
  const asNum = Number(key);
  if (Number.isInteger(asNum) && asNum >= 0 && asNum < varIds.length) {
    return asNum;
  }
  return null;
}

function buildPythonContextualBanditSettings(
  settings: ContextualBanditSettingsForStatsEngine,
  decisionMetricId: string,
  analysisWeights: number[],
): PythonContextualBanditSettings & { max_leaves: number } {
  const numVariations = settings.var_ids.length;
  const fallbackWeights =
    analysisWeights.length === numVariations
      ? analysisWeights
      : Array(numVariations).fill(1 / numVariations);

  return {
    var_names: settings.var_names,
    var_ids: settings.var_ids,
    // `current_weights` is inherited from BanditSettingsForStatsEngine and
    // unused by the contextual code path (which reads
    // `current_contextual_weights` instead). Kept populated with a sensible
    // fallback so the parent dataclass invariant still holds.
    current_weights: fallbackWeights,
    current_contextual_weights: settings.current_weights_by_context,
    reweight: settings.reweight,
    decision_metric: decisionMetricId,
    bandit_weights_seed: settings.bandit_weights_seed,
    attributes: settings.contextual_attributes.map(contextualBanditAttrCol),
    max_leaves: settings.max_leaves,
  };
}

async function runContextualStatsEngineWithPython(
  settings: ContextualBanditSettingsForStatsEngine,
  rows: ExperimentMetricQueryResponseRows,
  runParams: RunContextualStatsEngineOptions,
): Promise<ContextualBanditResult> {
  const {
    snapshotId,
    sql,
    decisionMetricId,
    snapshotSettings,
    analysisSettings,
    metricMap,
    variations,
    coverage,
    phaseLengthDays,
  } = runParams;

  const decisionMetric = metricMap.get(decisionMetricId);
  if (!decisionMetric) {
    throw new Error(`Decision metric not found: ${decisionMetricId}`);
  }

  const reportVariations = variations.map((v, index) => ({
    id: v.id,
    name: v.name,
    weight: v.weight,
    index,
  }));

  const analysisForEngine = getAnalysisSettingsForStatsEngine(
    analysisSettings,
    reportVariations,
    coverage,
    phaseLengthDays,
  );

  const contextualBanditSettings = buildPythonContextualBanditSettings(
    settings,
    decisionMetricId,
    analysisForEngine.weights,
  );

  const statsRows = rows;

  const analysis = (
    await runStatsEngine([
      {
        id: snapshotId,
        data: {
          metrics: {
            [decisionMetricId]: getMetricSettingsForStatsEngine(
              decisionMetric,
              metricMap,
              snapshotSettings,
            ),
          },
          analyses: [analysisForEngine],
          query_results: [
            {
              rows: statsRows,
              metrics: [decisionMetricId],
              sql,
            },
          ],
          contextual_bandit_settings: contextualBanditSettings,
        },
      },
    ])
  )?.[0];

  if (!analysis) {
    throw new Error("Error in stats engine: no rows returned");
  }
  if (analysis.error) {
    let errorMsg =
      "Failed to run contextual bandit stats model:\n" + analysis.error;
    logger.error(analysis.error, errorMsg);
    if (analysis.traceback) {
      logger.error("Traceback:\n" + analysis.traceback);
      errorMsg += "\n\n" + analysis.traceback;
    }
    throw new Error(errorMsg);
  }
  if (!analysis.contextualBanditResult) {
    throw new Error(
      "Error in stats engine: contextual bandit result missing from response",
    );
  }

  return {
    attributes: settings.contextual_attributes,
    responses: analysis.contextualBanditResult.responses,
    leaf_map: analysis.contextualBanditResult.leaf_map,
  };
}

// SMITH: delete this whole function once `runContextualStatsEngine` calls
// the real Python stats engine. The single-leaf catch-all fit it produces
// is intentionally not representative of any real tree; it's only here so
// downstream code paths (CBE persistence, payload refresh, SDK threading)
// can be exercised against deterministic output.
function mockFit(
  settings: ContextualBanditSettingsForStatsEngine,
  rows: ExperimentMetricQueryResponseRows,
): ContextualBanditResult {
  // Bucket all rows into a single "catch-all" leaf and compute simple
  // posterior-mean weights (Thompson on aggregate).
  const numVar = settings.var_names.length;
  const sumByVar = Array(numVar).fill(0) as number[];
  const nByVar = Array(numVar).fill(0) as number[];

  rows.forEach((r) => {
    const v = variationIndexFromRow(r, settings.var_ids);
    if (v === null) {
      return;
    }
    const mainSum = Number(r.main_sum ?? 0);
    sumByVar[v] += Number.isFinite(mainSum) ? mainSum : 0;
    nByVar[v] += r.users ?? r.count ?? 0;
  });

  const means = sumByVar.map((s, i) => (nByVar[i] ? s / nByVar[i] : 0));
  const expMeans = means.map((m) => Math.exp(m * 100));
  const total = expMeans.reduce((a, b) => a + b, 0) || 1;
  const weights = expMeans.map((e) => e / total);

  return {
    attributes: settings.contextual_attributes,
    responses: [
      {
        context: {},
        sampleSizePerVariation: nByVar,
        variationMeans: means,
        updatedWeights: weights,
        bestArmProbabilities: weights,
        updateMessage: "Mock fitter: single catch-all leaf",
      },
    ],
  };
}
