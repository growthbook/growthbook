import groupBy from "lodash/groupBy";
import isEqual from "lodash/isEqual";
import pickBy from "lodash/pickBy";
import type {
  ExperimentSnapshotAnalysis,
  ExperimentSnapshotInterface,
  SnapshotMetricRefresh,
  SnapshotVariation,
} from "shared/types/experiment-snapshot";
import type { ExperimentReportResults } from "shared/types/report";
import type { Queries, QueryPointer } from "shared/types/query";
import type { ExperimentMetricInterface } from "shared/experiments";
import type { ReqContext } from "back-end/types/request";
import type { ApiReqContext } from "back-end/types/api";
import {
  findSnapshotById,
  getSnapshotQueryPointers,
} from "back-end/src/models/ExperimentSnapshotModel";
import {
  createNewQueryFromCached,
  getQueriesByIds,
} from "back-end/src/models/QueryModel";
import {
  analyzeExperimentResults,
  getMetricsAndQueryDataForStatsEngine,
} from "back-end/src/services/stats";
import { checkSrm } from "back-end/src/util/stats";
import type { QueryMap } from "back-end/src/queryRunners/QueryRunner";
import type { AnalyzedSnapshotResults } from "back-end/src/queryRunners/ExperimentResultsQueryRunner";

/**
 * The parent's queries that `keep` selects, by name. Calling one copies that
 * finished query into a new query document under the same name.
 */
export async function getParentQueryCopiers(
  context: ReqContext | ApiReqContext,
  metricRefresh: SnapshotMetricRefresh,
  keep: (pointer: QueryPointer) => boolean,
): Promise<Map<string, () => Promise<QueryPointer>>> {
  const parentQueries = await getSnapshotQueryPointers(
    context,
    metricRefresh.parentSnapshotId,
  );
  if (!parentQueries) {
    throw new Error(
      `Could not load snapshot ${metricRefresh.parentSnapshotId} to copy its results`,
    );
  }
  const pointers = parentQueries.filter(keep);
  const docs = new Map(
    (
      await getQueriesByIds(
        context,
        pointers.map((p) => p.query),
        false,
      )
    ).map((doc) => [doc.id, doc]),
  );
  return new Map(
    pointers.map((pointer) => [
      pointer.name,
      async () => {
        const existing = docs.get(pointer.query);
        if (existing?.status !== "succeeded") {
          throw new Error(
            `Query "${pointer.name}" of snapshot ${metricRefresh.parentSnapshotId} is no longer available`,
          );
        }
        const copy = await createNewQueryFromCached({
          existing,
          dependencies: [],
          runAtEnd: false,
        });
        return { name: pointer.name, query: copy.id, status: copy.status };
      },
    ]),
  );
}

/**
 * The refresh's queries that this run started. A carried query is a copy of
 * the parent's query with the same name, so it shares that query's source.
 */
export function getQueriesStartedByRefresh(
  queryMap: QueryMap,
  parentQuerySources: ReadonlyMap<string, string>,
): QueryMap {
  return new Map(
    [...queryMap].filter(
      ([name, query]) =>
        !query.cachedQueryUsed ||
        parentQuerySources.get(name) !== query.cachedQueryUsed,
    ),
  );
}

async function getParentQuerySources(
  context: ReqContext | ApiReqContext,
  parentQueries: Queries,
): Promise<Map<string, string>> {
  const docs = await getQueriesByIds(
    context,
    parentQueries.map((q) => q.query),
    false,
  );
  const sourceById = new Map(
    docs.map((doc) => [doc.id, doc.cachedQueryUsed || doc.id]),
  );
  return new Map(
    parentQueries.flatMap((q): [string, string][] => {
      const source = sourceById.get(q.query);
      return source ? [[q.name, source]] : [];
    }),
  );
}

/**
 * Each parent analysis with the copied metrics' results kept verbatim and the
 * fresh metrics' results added. A copied metric is one the refresh still
 * analyzes and no query of this run returned rows for. Units are the most any
 * metric saw, as in a full analysis, and SRM is recomputed when they change.
 */
export function mergeMetricRefreshAnalyses({
  analyses,
  freshResults,
  analyzedMetricIds,
  freshMetricIds,
  variationWeights,
}: {
  analyses: ExperimentSnapshotAnalysis[];
  freshResults: ExperimentReportResults["dimensions"][];
  analyzedMetricIds: ReadonlySet<string>;
  freshMetricIds: ReadonlySet<string>;
  variationWeights: number[];
}): ExperimentSnapshotAnalysis[] {
  const copiedMetrics = (metrics: SnapshotVariation["metrics"]) =>
    pickBy(
      metrics,
      (_, metricId) =>
        analyzedMetricIds.has(metricId) && !freshMetricIds.has(metricId),
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
              ...added?.metrics,
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
    return { ...analysis, results: [...merged, ...fresh.values()] };
  });
}

/**
 * Extends every analysis of the parent with the metrics this run queried. The
 * stats engine sees only this run's query rows, so a copied metric keeps the
 * numbers its parent computed under the definition it had then.
 */
export async function analyzeMetricRefresh({
  context,
  snapshot,
  metricRefresh,
  queryMap,
  metricMap,
  variationNames,
}: {
  context: ReqContext | ApiReqContext;
  snapshot: ExperimentSnapshotInterface;
  metricRefresh: SnapshotMetricRefresh;
  queryMap: QueryMap;
  metricMap: Map<string, ExperimentMetricInterface>;
  variationNames: string[];
}): Promise<AnalyzedSnapshotResults> {
  const parent = await findSnapshotById(
    context,
    metricRefresh.parentSnapshotId,
  );
  // The default analysis must stay first, or the refresh would show another.
  if (parent?.analyses[0]?.status !== "success") {
    throw new Error(
      `Snapshot ${metricRefresh.parentSnapshotId} has no finished results to add the new metrics to`,
    );
  }
  // An analysis that failed or is still being computed is left out, so a
  // request for it computes it like any analysis a snapshot lacks.
  const analyses = parent.analyses.filter((a) => a.status === "success");
  const freshQueries = getQueriesStartedByRefresh(
    queryMap,
    await getParentQuerySources(context, parent.queries),
  );
  const analyzedMetricIds = new Set(
    snapshot.settings.metricSettings.map((m) => m.id),
  );
  const freshMetricIds = new Set(
    Object.keys(
      getMetricsAndQueryDataForStatsEngine(
        freshQueries,
        metricMap,
        snapshot.settings,
        analyzedMetricIds,
      ).metricSettings,
    ),
  );

  // Stored analyses keep the parent's settings, which the front end matches
  // by equality, but the fresh metrics count among today's goals and guardrails.
  const { numGoalMetrics, numGuardrailMetrics } = (
    snapshot.analyses[0] ?? parent.analyses[0]
  ).settings;

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
      analysisSettings: indexes.map((i) => ({
        ...analyses[i].settings,
        numGoalMetrics,
        numGuardrailMetrics,
      })),
      variationNames,
      metricMap,
      analyzedMetricIds,
    });
    indexes.forEach((analysisIndex, j) => {
      freshResults[analysisIndex] = results[j];
    });
  }

  return {
    analyses: mergeMetricRefreshAnalyses({
      analyses,
      freshResults: freshResults.map((r) => r?.dimensions ?? []),
      analyzedMetricIds,
      freshMetricIds,
      variationWeights: snapshot.settings.variations.map((v) => v.weight),
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

/** Copies every parent query that `keep` selects. */
export async function carryMetricRefreshQueries(
  context: ReqContext | ApiReqContext,
  metricRefresh: SnapshotMetricRefresh,
  keep: (pointer: QueryPointer) => boolean,
): Promise<Queries> {
  const copiers = await getParentQueryCopiers(context, metricRefresh, keep);
  return Promise.all([...copiers.values()].map((copy) => copy()));
}
