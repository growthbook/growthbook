import groupBy from "lodash/groupBy";
import isEqual from "lodash/isEqual";
import pickBy from "lodash/pickBy";
import type {
  ExperimentSnapshotAnalysis,
  ExperimentSnapshotInterface,
  SnapshotNewMetricsUpdate,
  SnapshotVariation,
} from "shared/types/experiment-snapshot";
import type { ExperimentReportResults } from "shared/types/report";
import type { BanditResult } from "shared/types/experiment";
import type { Queries, QueryPointer, QueryStatus } from "shared/types/query";
import {
  getDefinitionMetricId,
  getNewMetricsUpdate,
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
import {
  getIndexAfterLastGroup,
  isCarriedNewMetricsUpdateQuery,
  isTableCleanupQuery,
  type ResultQueryScope,
} from "back-end/src/queryRunners/newMetricsUpdateQueryNaming";

export type AnalyzedSnapshotResults = {
  unknownVariations: string[];
  multipleExposures: number;
  analyses: ExperimentSnapshotAnalysis[];
  banditResult?: BanditResult;
};

type NewMetricsUpdateSnapshot = Pick<
  ExperimentSnapshotInterface,
  "runnerKind" | "settings"
>;

/**
 * The parent's carried queries, by name. Calling one copies that finished
 * query into a new query document under the same name.
 */
async function getParentQueryCopiers(
  context: ReqContext | ApiReqContext,
  snapshot: NewMetricsUpdateSnapshot,
  newMetricsUpdate: SnapshotNewMetricsUpdate,
): Promise<Map<string, () => Promise<QueryPointer>>> {
  const parentQueries = await getSnapshotQueryPointers(
    context,
    newMetricsUpdate.parentSnapshotId,
  );
  if (!parentQueries) {
    throw new Error(
      `Could not load snapshot ${newMetricsUpdate.parentSnapshotId} to copy its results`,
    );
  }
  const pointers = parentQueries.filter(({ name }) =>
    isCarriedNewMetricsUpdateQuery(name, snapshot, newMetricsUpdate),
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
            `Query "${pointer.name}" of snapshot ${newMetricsUpdate.parentSnapshotId} is no longer available`,
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
 * The new-metrics update's queries that this run started. A carried query
 * keeps its parent query's name, and every query a new-metrics update starts
 * has a new name: new result groups are numbered after the parent's, and a
 * rebuilt Incremental Pipeline cache gets a new group id.
 */
function getQueriesStartedByNewMetricsUpdate(
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
export function mergeNewMetricsUpdateAnalyses({
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
    analyses: mergeNewMetricsUpdateAnalyses({
      analyses,
      freshResults: freshResults.map((r) => r?.dimensions ?? []),
      analyzedMetricIds,
      newMetricIds: new Set(newMetricsUpdate.metricIds),
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

/**
 * Copies every carried query of the parent, then starts the standard
 * pipeline's queries for the new metrics, numbering their groups after the
 * copied ones.
 */
export async function startNewMetricsUpdateResultQueries(
  context: ReqContext | ApiReqContext,
  snapshot: NewMetricsUpdateSnapshot,
  newMetricsUpdate: SnapshotNewMetricsUpdate,
  startResultQueries: (scope: ResultQueryScope) => Promise<Queries>,
): Promise<Queries> {
  const copiers = await getParentQueryCopiers(
    context,
    snapshot,
    newMetricsUpdate,
  );
  const carried = await Promise.all(
    [...copiers.values()].map((copy) => copy()),
  );
  const started = await startResultQueries({
    metricIds: new Set(newMetricsUpdate.metricIds),
    firstGroupIndex: getIndexAfterLastGroup(carried.map((q) => q.name)),
  });
  return [...carried, ...started];
}

type StartQuery = (
  params: StartQueryParams<RowsType, ProcessedRowsType>,
) => Promise<QueryPointer>;

/**
 * `startQuery` for a new-metrics update that names its queries as its parent
 * did: a carried query is copied from the parent instead of run. A query
 * reading a cache rebuilt in this run is named after the cache's new group id,
 * so it runs.
 */
export async function getNewMetricsUpdateStartQuery(
  context: ReqContext | ApiReqContext,
  snapshot: NewMetricsUpdateSnapshot,
  newMetricsUpdate: SnapshotNewMetricsUpdate,
  startQuery: StartQuery,
): Promise<StartQuery> {
  const copiers = await getParentQueryCopiers(
    context,
    snapshot,
    newMetricsUpdate,
  );
  return (query) => copiers.get(query.name)?.() ?? startQuery(query);
}

/**
 * A new-metrics update can't partly succeed on either pipeline, since its
 * results would lack metrics. A failed drop of a table it no longer needs
 * doesn't count.
 */
export function getNewMetricsUpdateQueryStatus(
  snapshot: Pick<
    ExperimentSnapshotInterface,
    "id" | "type" | "newMetricsUpdate" | "queries"
  >,
  status: QueryStatus,
): QueryStatus {
  if (status !== "partially-succeeded" || !getNewMetricsUpdate(snapshot)) {
    return status;
  }
  const incomplete = snapshot.queries.some(
    (q) => q.status === "failed" && !isTableCleanupQuery(q.name, snapshot.id),
  );
  return incomplete ? "failed" : status;
}
