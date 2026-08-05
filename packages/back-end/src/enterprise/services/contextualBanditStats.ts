import {
  ExperimentMetricInterface,
  metricRowAttributeReader,
} from "shared/experiments";
import { ExperimentMetricQueryResponseRows } from "shared/types/integrations";
import {
  ExperimentSnapshotAnalysisSettings,
  ExperimentSnapshotSettings,
} from "shared/types/experiment-snapshot";
import type { ContextualBanditSnapshot } from "shared/types/stats";
import {
  computeContextualBanditWeights,
  type ContextualBanditArm,
  type ContextualBanditObservation,
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

function num(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** Fact-metric rows report units as `count`; snapshot metric rows use `users`. */
function unitsFromRow(row: ExperimentMetricQueryResponseRows[number]): number {
  if ((row.count ?? null) !== null) return num(row.count);
  if ((row.users ?? null) !== null) return num(row.users);
  return 0;
}

function armFromRow(
  row: ExperimentMetricQueryResponseRows[number],
): ContextualBanditArm {
  return {
    n: unitsFromRow(row),
    main_sum: num(row.main_sum),
    main_sum_squares: num(row.main_sum_squares),
    denominator_sum: num(row.denominator_sum),
    denominator_sum_squares: num(row.denominator_sum_squares),
    main_denominator_sum_product: num(row.main_denominator_sum_product),
    covariate_sum: num(row.covariate_sum),
    covariate_sum_squares: num(row.covariate_sum_squares),
    main_covariate_sum_product: num(row.main_covariate_sum_product),
  };
}

/**
 * Attribute values keyed by their configured name.
 */
function contextFromRow(
  row: ExperimentMetricQueryResponseRows[number],
  attributes: string[],
): Record<string, string> {
  const attributeValue = metricRowAttributeReader(row);
  const context: Record<string, string> = {};
  for (const attribute of attributes) {
    const value = attributeValue(attribute);
    if ((value ?? null) !== null) {
      context[attribute] = String(value);
    }
  }
  return context;
}

/**
 * Resolve query rows into the observations the stats engine consumes.
 */
export function buildContextualBanditObservations(
  rows: ExperimentMetricQueryResponseRows,
  { varIds, attributes }: { varIds: string[]; attributes: string[] },
): ContextualBanditObservation[] {
  const observations: ContextualBanditObservation[] = [];
  for (const row of prepareRowsForContextualStats(rows)) {
    const variationIndex = variationIndexFromRow(row, varIds);
    if (variationIndex === null) {
      continue;
    }
    observations.push({
      variationIndex,
      context: contextFromRow(row, attributes),
      arm: armFromRow(row),
    });
  }
  return observations;
}

export async function runContextualStatsEngine(
  settings: ContextualBanditStatsSettings,
  rows: ExperimentMetricQueryResponseRows,
  runParams?: RunContextualStatsEngineOptions,
): Promise<ContextualBanditResult> {
  if (!runParams) {
    throw new Error(
      "Contextual stats engine requires runParams when mock stats are disabled",
    );
  }
  const observations = buildContextualBanditObservations(rows, {
    varIds: settings.varIds,
    attributes: settings.contextualAttributes,
  });
  const input = buildContextualBanditWeightsInput(
    settings,
    observations,
    runParams,
  );
  return computeContextualBanditWeights(input);
}

function buildContextualBanditWeightsInput(
  settings: ContextualBanditStatsSettings,
  observations: ContextualBanditObservation[],
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
    observations,
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
