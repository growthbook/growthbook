import cloneDeep from "lodash/cloneDeep";
import groupBy from "lodash/groupBy";
import isEqual from "lodash/isEqual";
import mapValues from "lodash/mapValues";
import pickBy from "lodash/pickBy";
import type {
  ExperimentSnapshotAnalysis,
  ExperimentSnapshotInterface,
  SnapshotNewMetricsUpdate,
  SnapshotVariation,
} from "shared/types/experiment-snapshot";
import type { ExperimentReportResults } from "shared/types/report";
import type { BanditResult } from "shared/types/experiment";
import {
  enrichAnalysisResults,
  getDefinitionMetricId,
  getNewMetricsUpdate,
  type ExperimentMetricInterface,
} from "shared/experiments";
import type { ReqContext } from "back-end/types/request";
import type { ApiReqContext } from "back-end/types/api";
import { findSnapshotById } from "back-end/src/models/ExperimentSnapshotModel";
import { analyzeExperimentResults } from "back-end/src/services/stats";
import { checkSrm } from "back-end/src/util/stats";
import type { QueryMap } from "back-end/src/queryRunners/QueryRunner";
import { getQueriesStartedByNewMetricsUpdate } from "back-end/src/services/experimentResults/query/newMetricsUpdateQueries";

export type AnalyzedSnapshotResults = {
  unknownVariations: string[];
  multipleExposures: number;
  analyses: ExperimentSnapshotAnalysis[];
  banditResult?: BanditResult;
};
/**
 * Each parent analysis with the copied metrics' per-test results kept and the
 * new metrics' results added. Only the new metrics, with their slices and
 * funnel steps, take fresh results: a rebuilt Incremental Pipeline cache also
 * returns rows for the other metrics of its fact table, and those keep the
 * parent's numbers. Units are the most any metric saw, as in a full analysis,
 * and SRM is recomputed when they change. The values that depend on more than
 * one test (corrected p-values, power) are then computed over copied and new
 * metrics together, for `goalMetrics`.
 */
export function mergeNewMetricsUpdateAnalyses({
  analyses,
  freshResults,
  analyzedMetricIds,
  newMetricIds,
  variationWeights,
  goalMetrics,
}: {
  analyses: ExperimentSnapshotAnalysis[];
  freshResults: ExperimentReportResults["dimensions"][];
  analyzedMetricIds: ReadonlySet<string>;
  newMetricIds: ReadonlySet<string>;
  variationWeights: number[];
  goalMetrics: string[];
}): ExperimentSnapshotAnalysis[] {
  const isNew = (metricId: string) =>
    newMetricIds.has(getDefinitionMetricId(metricId));
  const addedMetrics = (metrics: SnapshotVariation["metrics"]) =>
    pickBy(metrics, (_, metricId) => isNew(metricId));
  // Copies, since the cross-metric values are set in place.
  const copiedMetrics = (metrics: SnapshotVariation["metrics"]) =>
    mapValues(
      pickBy(
        metrics,
        (_, metricId) => analyzedMetricIds.has(metricId) && !isNew(metricId),
      ),
      (metric) => cloneDeep(metric),
    );
  return analyses.map((analysis, i) => {
    const fresh = new Map(
      (freshResults[i] ?? [])
        .filter((d) => d.variations.length)
        .map((d) => [d.name, d]),
    );
    const merged = analysis.results.map((dimension) => {
      const freshDimension = fresh.get(dimension.name);
      fresh.delete(dimension.name);
      if (!freshDimension) {
        return {
          ...dimension,
          variations: dimension.variations.map((v) => ({
            ...v,
            metrics: copiedMetrics(v.metrics),
          })),
        };
      }
      const variations = Array.from(
        {
          length: Math.max(
            dimension.variations.length,
            freshDimension.variations.length,
          ),
        },
        (_, v) => {
          const copied = dimension.variations[v];
          const added = freshDimension.variations[v];
          return {
            users: Math.max(copied?.users ?? 0, added?.users ?? 0),
            metrics: {
              ...copiedMetrics(copied?.metrics ?? {}),
              ...addedMetrics(added?.metrics ?? {}),
            },
          };
        },
      );
      const users = variations.map((v) => v.users);
      return {
        ...dimension,
        srm: isEqual(
          users,
          dimension.variations.map((v) => v.users),
        )
          ? dimension.srm
          : checkSrm(users, variationWeights),
        variations,
      };
    });
    const added = [...fresh.values()].map((dimension) => ({
      ...dimension,
      variations: dimension.variations.map((v) => ({
        ...v,
        metrics: addedMetrics(v.metrics),
      })),
    }));
    const results = [...merged, ...added];
    enrichAnalysisResults({
      results,
      analysisSettings: analysis.settings,
      snapshotSettings: { goalMetrics },
    });
    return { ...analysis, results };
  });
}

/**
 * Extends every analysis of the parent with the new metrics. The stats engine
 * sees only this run's query rows, and every other metric keeps the numbers
 * its parent computed under the definition it had then.
 */
export async function analyzeNewMetricsUpdate({
  context,
  snapshot,
  newMetricsUpdate,
  queryMap,
  metricMap,
  variationNames,
}: {
  context: ReqContext | ApiReqContext;
  snapshot: ExperimentSnapshotInterface;
  newMetricsUpdate: SnapshotNewMetricsUpdate;
  queryMap: QueryMap;
  metricMap: Map<string, ExperimentMetricInterface>;
  variationNames: string[];
}): Promise<AnalyzedSnapshotResults> {
  const parent = await findSnapshotById(
    context,
    newMetricsUpdate.parentSnapshotId,
  );
  // The default analysis must stay first, or the new-metrics update would show
  // another.
  if (parent?.analyses[0]?.status !== "success") {
    throw new Error(
      `Snapshot ${newMetricsUpdate.parentSnapshotId} has no finished results to add the new metrics to`,
    );
  }
  // An analysis that failed or is still being computed is left out, so a
  // request for it computes it like any analysis a snapshot lacks.
  const analyses = parent.analyses.filter((a) => a.status === "success");
  const freshQueries = getQueriesStartedByNewMetricsUpdate(
    queryMap,
    parent.queries,
  );
  const analyzedMetricIds = new Set(
    snapshot.settings.metricSettings.map((m) => m.id),
  );

  // One run per dimension: an isolated dimension reads its own queries.
  const freshResults: ExperimentReportResults[] = [];
  for (const indexes of Object.values(
    groupBy(
      analyses.map((_, i) => i),
      (i) => analyses[i].settings.dimensions[0] ?? "",
    ),
  )) {
    const { results } = await analyzeExperimentResults({
      queryData: freshQueries,
      snapshotSettings: snapshot.settings,
      analysisSettings: indexes.map((i) => analyses[i].settings),
      variationNames,
      metricMap,
    });
    indexes.forEach((analysisIndex, j) => {
      freshResults[analysisIndex] = results[j];
    });
  }

  return {
    analyses: mergeNewMetricsUpdateAnalyses({
      analyses,
      freshResults: freshResults.map((r) => r?.dimensions ?? []),
      analyzedMetricIds,
      newMetricIds: new Set(newMetricsUpdate.queriedMetricIds),
      variationWeights: snapshot.settings.variations.map((v) => v.weight),
      goalMetrics: snapshot.settings.goalMetrics,
    }),
    unknownVariations: [
      ...new Set([
        ...parent.unknownVariations,
        ...freshResults.flatMap((r) => r?.unknownVariations ?? []),
      ]),
    ],
    multipleExposures: Math.max(
      parent.multipleExposures,
      ...freshResults.map((r) => r?.multipleExposures ?? 0),
    ),
  };
}

/**
 * Stats engine results for every analysis of a snapshot. A new-metrics update
 * analyzes only the metrics its own queries returned and copies the rest.
 */
export async function analyzeSnapshotResults({
  context,
  snapshot,
  queryMap,
  metricMap,
  variationNames,
}: {
  context: ApiReqContext;
  snapshot: ExperimentSnapshotInterface;
  queryMap: QueryMap;
  metricMap: Map<string, ExperimentMetricInterface>;
  variationNames: string[];
}): Promise<AnalyzedSnapshotResults> {
  const newMetricsUpdate = getNewMetricsUpdate(snapshot);
  if (newMetricsUpdate) {
    return analyzeNewMetricsUpdate({
      context,
      snapshot,
      newMetricsUpdate,
      queryMap,
      metricMap,
      variationNames,
    });
  }
  const { results, banditResult } = await analyzeExperimentResults({
    queryData: queryMap,
    snapshotSettings: snapshot.settings,
    analysisSettings: snapshot.analyses.map((a) => a.settings),
    variationNames,
    metricMap,
  });
  const result: AnalyzedSnapshotResults = {
    analyses: snapshot.analyses,
    multipleExposures: 0,
    unknownVariations: [],
    banditResult,
  };
  results.forEach((results: ExperimentReportResults, i: number) => {
    const analysis = snapshot.analyses[i];
    if (!analysis) return;

    analysis.results = results.dimensions || [];
    analysis.status = "success";
    analysis.error = "";

    // TODO: do this once, not per analysis
    result.unknownVariations = results.unknownVariations || [];
    result.multipleExposures = results.multipleExposures ?? 0;
  });
  return result;
}
