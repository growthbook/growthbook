import { v4 as uuidv4 } from "uuid";
import {
  DataVizConfig,
  deleteSavedQueryValidator,
  getSavedQueryValidator,
  listSavedQueriesValidator,
  postSavedQueryRefreshValidator,
  postSavedQueryValidator,
  SavedQuery,
  updateSavedQueryValidator,
} from "shared/validators";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { executeAndSaveQuery } from "back-end/src/routers/saved-queries/saved-queries.controller";
import { NotFoundError } from "back-end/src/util/errors";
import { ApiReqContext } from "back-end/types/api";
import { ReqContext } from "back-end/types/request";
import { createApiRequestHandler } from "back-end/src/util/handler";

function toApiSavedQuery(q: SavedQuery) {
  return {
    id: q.id,
    datasourceId: q.datasourceId,
    name: q.name,
    sql: q.sql,
    dataVizConfig: q.dataVizConfig ?? [],
    linkedDashboardIds: q.linkedDashboardIds ?? [],
    dateLastRan: q.dateLastRan.toISOString(),
    lastRun: {
      rowCount: q.results?.results?.length ?? 0,
      error: q.results?.error ?? null,
      duration: q.results?.duration ?? null,
    },
    dateCreated: q.dateCreated.toISOString(),
    dateUpdated: q.dateUpdated.toISOString(),
  };
}

// Charts are addressed by id from dashboard blocks, so every one needs one.
function withVizIds(configs: DataVizConfig[]): DataVizConfig[] {
  return configs.map((c) => ({ ...c, id: c.id || `data-viz_${uuidv4()}` }));
}

function assertPlanAllows(context: ApiReqContext) {
  if (!context.hasPremiumFeature("saveSqlExplorerQueries")) {
    context.throwPlanDoesNotAllowError(
      "Your organization's plan does not support saving queries",
    );
  }
}

async function getSavedQuery(context: ApiReqContext, id: string) {
  assertPlanAllows(context);
  const savedQuery = await context.models.savedQueries.getById(id);
  if (!savedQuery) throw new NotFoundError(`Saved query not found: ${id}`);
  return savedQuery;
}

async function runAndSave(context: ApiReqContext, savedQuery: SavedQuery) {
  const datasource = await getDataSourceById(context, savedQuery.datasourceId);
  if (!datasource) throw new NotFoundError("Cannot find datasource");
  // Returns the run's output only when it failed; success is saved instead
  const failed = await executeAndSaveQuery(
    context as ReqContext,
    savedQuery,
    datasource,
  );
  const saved = await getSavedQuery(context, savedQuery.id);
  return { saved, error: failed ? (failed.error ?? "Query failed") : null };
}

export const listSavedQueries = createApiRequestHandler(
  listSavedQueriesValidator,
)(async (req) => {
  assertPlanAllows(req.context);
  const all = await req.context.models.savedQueries.getAll();
  const { datasourceId } = req.query;
  return {
    savedQueries: all
      .filter((q) => !datasourceId || q.datasourceId === datasourceId)
      .map(toApiSavedQuery),
  };
});

export const getSavedQueryHandler = createApiRequestHandler(
  getSavedQueryValidator,
)(async (req) => ({
  savedQuery: toApiSavedQuery(await getSavedQuery(req.context, req.params.id)),
}));

export const postSavedQuery = createApiRequestHandler(postSavedQueryValidator)(
  async (req) => {
    const { context } = req;
    assertPlanAllows(context);
    const { datasourceId, name, sql, dataVizConfig, runNow } = req.body;
    if (!(await getDataSourceById(context, datasourceId))) {
      throw new NotFoundError("Cannot find datasource");
    }
    const created = await context.models.savedQueries.create({
      datasourceId,
      name,
      sql,
      dataVizConfig: withVizIds(dataVizConfig ?? []),
      dateLastRan: new Date(),
      results: { results: [], sql },
    });
    if (runNow === false) return { savedQuery: toApiSavedQuery(created) };
    const { saved } = await runAndSave(context, created);
    return { savedQuery: toApiSavedQuery(saved) };
  },
);

export const updateSavedQuery = createApiRequestHandler(
  updateSavedQueryValidator,
)(async (req) => {
  const existing = await getSavedQuery(req.context, req.params.id);
  const { dataVizConfig, ...rest } = req.body;
  const updated = await req.context.models.savedQueries.update(existing, {
    ...rest,
    ...(dataVizConfig ? { dataVizConfig: withVizIds(dataVizConfig) } : {}),
  });
  return { savedQuery: toApiSavedQuery(updated) };
});

export const deleteSavedQuery = createApiRequestHandler(
  deleteSavedQueryValidator,
)(async (req) => {
  const existing = await getSavedQuery(req.context, req.params.id);
  await req.context.models.savedQueries.delete(existing);
  return { deletedId: existing.id };
});

export const postSavedQueryRefresh = createApiRequestHandler(
  postSavedQueryRefreshValidator,
)(async (req) => {
  const existing = await getSavedQuery(req.context, req.params.id);
  const { saved, error } = await runAndSave(req.context, existing);
  return {
    savedQuery: toApiSavedQuery(saved),
    results: saved.results?.results ?? [],
    error,
  };
});
