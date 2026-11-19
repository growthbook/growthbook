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
import type { BanditResult } from "shared/types/experiment";
import type { Queries, QueryPointer } from "shared/types/query";
import {
  getDefinitionMetricId,
  type ExperimentMetricInterface,
} from "shared/experiments";
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
import { analyzeExperimentResults } from "back-end/src/services/stats";
import { checkSrm } from "back-end/src/util/stats";
import type {
  ProcessedRowsType,
  QueryMap,
  RowsType,
  StartQueryParams,
} from "back-end/src/queryRunners/QueryRunner";
import { isCarriedMetricRefreshQuery } from "back-end/src/queryRunners/metricRefreshQueryNaming";

export type AnalyzedSnapshotResults = {
  unknownVariations: string[];
  multipleExposures: number;
  analyses: ExperimentSnapshotAnalysis[];
  banditResult?: BanditResult;
};

type RefreshSnapshot = Pick<
  ExperimentSnapshotInterface,
  "runnerKind" | "settings"
>;

/**
 * The parent's carried queries, by name. Calling one copies that finished
 * query into a new query document under the same name.
 */
async function getParentQueryCopiers(
  context: ReqContext | ApiReqContext,
  refresh: RefreshSnapshot,
  metricRefresh: SnapshotMetricRefresh,
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
  const pointers = parentQueries.filter(({ name }) =>
    isCarriedMetricRefreshQuery(name, refresh, metricRefresh),
  );
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
 * The refresh's queries that this run started. A carried query keeps its
 * parent query's name, and every query a refresh starts has a new name: new
 * result groups are numbered after the parent's, and a rebuilt Incremental
 * Pipeline cache gets a new group id.
 */
function getQueriesStartedByRefresh(
  queryMap: QueryMap,
  parentQueries: Queries,
): QueryMap {
  const parentNames = new Set(parentQueries.map((q) => q.name));
  return new Map([...queryMap].filter(([name]) => !parentNames.has(name)));
}

/**
 * Each parent analysis with the copied metrics' results kept verbatim and the
 * new metrics' results added. Only the new metrics, with their slices and
 * funnel steps, take fresh results: a rebuilt Incremental Pipeline cache also
 * returns rows for the other metrics of its fact table, and those keep the
 * parent's numbers. Units are the most any metric saw, as in a full analysis,
 * and SRM is recomputed when they change.
 */
export function mergeMetricRefreshAnalyses({
  analyses,
  freshResults,
  analyzedMetricIds,
  newMetricIds,
  variationWeights,
}: {
  analyses: ExperimentSnapshotAnalysis[];
  freshResults: ExperimentReportResults["dimensions"][];
  analyzedMetricIds: ReadonlySet<string>;
  newMetricIds: ReadonlySet<string>;
  variationWeights: number[];
}): ExperimentSnapshotAnalysis[] {
  const isNew = (metricId: string) =>
    newMetricIds.has(getDefinitionMetricId(metricId));
  const copiedMetrics = (metrics: SnapshotVariation["metrics"]) =>
    pickBy(
      metrics,
      (_, metricId) => analyzedMetricIds.has(metricId) && !isNew(metricId),
    );
  const addedMetrics = (metrics: SnapshotVariation["metrics"]) =>
    pickBy(metrics, (_, metricId) => isNew(metricId));
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
    return { ...analysis, results: [...merged, ...added] };
  });
}

/**
 * Extends every analysis of the parent with the new metrics. The stats engine
 * sees only this run's query rows, and every other metric keeps the numbers
 * its parent computed under the definition it had then.
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
  const freshQueries = getQueriesStartedByRefresh(queryMap, parent.queries);
  const analyzedMetricIds = new Set(
    snapshot.settings.metricSettings.map((m) => m.id),
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
      newMetricIds: new Set(metricRefresh.metricIds),
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

export async function carryMetricRefreshQueries(
  context: ReqContext | ApiReqContext,
  refresh: RefreshSnapshot,
  metricRefresh: SnapshotMetricRefresh,
): Promise<Queries> {
  const copiers = await getParentQueryCopiers(context, refresh, metricRefresh);
  return Promise.all([...copiers.values()].map((copy) => copy()));
}

type StartQuery = (
  params: StartQueryParams<RowsType, ProcessedRowsType>,
) => Promise<QueryPointer>;

/**
 * `startQuery` for a metric refresh that names its queries as its parent did:
 * a carried query is copied from the parent instead of run. A query reading a
 * cache rebuilt in this run is named after the cache's new group id, so it runs.
 */
export async function getMetricRefreshStartQuery(
  context: ReqContext | ApiReqContext,
  refresh: RefreshSnapshot,
  metricRefresh: SnapshotMetricRefresh,
  startQuery: StartQuery,
): Promise<StartQuery> {
  const copiers = await getParentQueryCopiers(context, refresh, metricRefresh);
  return (query) => copiers.get(query.name)?.() ?? startQuery(query);
}
