import {
  contextualBanditAttrCol,
  ExperimentMetricInterface,
} from "shared/experiments";
import { ExperimentMetricQueryResponseRows } from "shared/types/integrations";
import {
  ExperimentSnapshotAnalysisSettings,
  SnapshotMetricRequest,
} from "shared/types/experiment-snapshot";
import type {
  ContextualBanditSettingsForStatsEngine as PythonContextualBanditSettings,
  ContextualBanditResponseSnapshot,
  ContextualBanditSnapshot,
  ContextualLeafMapEntry,
} from "shared/types/stats";
import {
  computeContextualBanditWeights,
  ContextualBanditWeightsInput,
} from "stats-ts";
// DEBUG CSV (gitignored): uncomment to dump weight-update output to CSVs.
import { writeContextualBanditDebugCsvs } from "back-end/src/enterprise/services/contextualBanditDebugCsv";
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
  // True: weights computed by Python gbstats. False: computed in TS via `computeContextualBanditWeights`.
  update_weights_using_python: boolean;
};

/** Mirrors gbstats `ContextualBanditResult` (per-context responses + optional tree leaf_map). */
export type ContextualBanditResult = ContextualBanditSnapshot;

export type RunContextualStatsEngineOptions = {
  snapshotId: string;
  sql?: string;
  decisionMetricId: string;
  snapshotSettings: SnapshotMetricRequest;
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
  if (!runParams) {
    throw new Error(
      "Contextual stats engine requires runParams when mock stats are disabled",
    );
  }
  if (!settings.update_weights_using_python) {
    const input = buildContextualBanditWeightsInput(
      settings,
      normalizedRows,
      runParams,
    );
    const result = computeContextualBanditWeights(input);
    // DEBUG CSV (gitignored): uncomment to dump weight-update output to CSVs.
    writeContextualBanditDebugCsvs(result);
    return result;
  }
  return runContextualStatsEngineWithPython(
    settings,
    normalizedRows,
    runParams,
  );
}

/** Packages metric/analysis settings + rows into the `stats-ts` weight engine input contract. */
function buildContextualBanditWeightsInput(
  settings: ContextualBanditSettingsForStatsEngine,
  rows: ExperimentMetricQueryResponseRows,
  runParams: RunContextualStatsEngineOptions,
): ContextualBanditWeightsInput {
  const {
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

  const metricSettings = getMetricSettingsForStatsEngine(
    decisionMetric,
    metricMap,
    snapshotSettings,
  );

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

  return {
    varIds: settings.var_ids,
    attributes: settings.contextual_attributes,
    maxLeaves: settings.max_leaves,
    minUsersPerLeaf: settings.min_users_per_leaf,
    metricSettings,
    analysisWeights: analysisForEngine.weights,
    rows,
  };
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

export function prepareRowsForContextualStats(
  rows: ExperimentMetricQueryResponseRows,
): ExperimentMetricQueryResponseRows {
  // CB decision metrics are always fact metrics (m0_* prefixed columns).
  return filterMetricQueryRowsForStatsEngine(stripInternalRowFields(rows), 0);
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
    // Unused by contextual path but populated to satisfy parent dataclass invariant.
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

  const decisionMetricSettings = getMetricSettingsForStatsEngine(
    decisionMetric,
    metricMap,
    snapshotSettings,
  );
  // Contextual bandits: CUPED covariate columns from SQL, but no pooled theta.
  if (decisionMetricSettings.keep_theta) {
    decisionMetricSettings.keep_theta = false;
  }

  const analysis = (
    await runStatsEngine([
      {
        id: snapshotId,
        data: {
          metrics: {
            [decisionMetricId]: decisionMetricSettings,
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

  // Surface per-context sample stats as `responses` for parity with the TS weight path.
  const pyResult =
    analysis.contextualBanditResult as ContextualBanditSnapshot & {
      responsesContext?: ContextualBanditResponseSnapshot[];
      leafMap?: ContextualLeafMapEntry[];
    };

  return {
    attributes: settings.contextual_attributes,
    responses: pyResult.responsesContext ?? pyResult.responses,
    leaf_map: pyResult.leafMap ?? pyResult.leaf_map,
  };
}
