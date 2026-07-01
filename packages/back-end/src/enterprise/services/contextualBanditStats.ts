import { ExperimentMetricInterface } from "shared/experiments";
import { ExperimentMetricQueryResponseRows } from "shared/types/integrations";
import {
  ExperimentSnapshotAnalysisSettings,
  ExperimentSnapshotSettings,
} from "shared/types/experiment-snapshot";
import type { ContextualBanditSnapshot } from "shared/types/stats";
import {
  computeContextualBanditWeights,
  ContextualBanditWeightsInput,
} from "stats-ts";
import {
  getAnalysisSettingsForStatsEngine,
  getMetricSettingsForStatsEngine,
} from "back-end/src/services/stats";

export type ContextualBanditStatsSettings = {
  varIds: string[];
  contextualAttributes: string[];
  maxLeaves: number;
  minUsersPerLeaf: number;
};

/** Mirrors gbstats `ContextualBanditResult` (per-context responses + optional tree leaf_map). */
export type ContextualBanditResult = ContextualBanditSnapshot;

export type RunContextualStatsEngineOptions = {
  snapshotId: string;
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
  settings: ContextualBanditStatsSettings,
  rows: ExperimentMetricQueryResponseRows,
  runParams?: RunContextualStatsEngineOptions,
): Promise<ContextualBanditResult> {
  const normalizedRows = canonicalizeVariationIdsInRows(
    prepareRowsForContextualStats(rows),
    settings.varIds,
  );
  if (!runParams) {
    throw new Error(
      "Contextual stats engine requires runParams when mock stats are disabled",
    );
  }
  const input = buildContextualBanditWeightsInput(
    settings,
    normalizedRows,
    runParams,
  );
  return computeContextualBanditWeights(input);
}

function buildContextualBanditWeightsInput(
  settings: ContextualBanditStatsSettings,
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
    varIds: settings.varIds,
    attributes: settings.contextualAttributes,
    maxLeaves: settings.maxLeaves,
    minUsersPerLeaf: settings.minUsersPerLeaf,
    metricSettings,
    analysisWeights: analysisForEngine.weights,
    rows,
  };
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
  return filterMetricQueryRowsForStatsEngine(rows, 0);
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
