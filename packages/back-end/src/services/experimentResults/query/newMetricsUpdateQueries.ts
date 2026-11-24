import type {
  ExperimentSnapshotInterface,
  SnapshotNewMetricsUpdate,
} from "shared/types/experiment-snapshot";
import type { Queries, QueryPointer, QueryStatus } from "shared/types/query";
import { getNewMetricsUpdate } from "shared/experiments";
import type { ReqContext } from "back-end/types/request";
import type { ApiReqContext } from "back-end/types/api";
import { getSnapshotQueryPointers } from "back-end/src/models/ExperimentSnapshotModel";
import {
  createNewQueryFromCached,
  getQueriesByIds,
} from "back-end/src/models/QueryModel";
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
} from "back-end/src/queryRunners/experimentQueryNaming";

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
export function getQueriesStartedByNewMetricsUpdate(
  queryMap: QueryMap,
  parentQueries: Queries,
): QueryMap {
  const parentNames = new Set(parentQueries.map((q) => q.name));
  return new Map([...queryMap].filter(([name]) => !parentNames.has(name)));
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
    metricIds: new Set(newMetricsUpdate.queriedMetricIds),
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
    "id" | "type" | "updateScope" | "queries"
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
