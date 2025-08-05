import { Response } from "express";
import { getValidDate } from "shared/dates";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { getContextFromReq } from "back-end/src/services/organizations";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import {
  SavedQuery,
  SavedQueryCreateProps,
  SavedQueryUpdateProps,
} from "back-end/src/validators/saved-queries";
import { orgHasPremiumFeature } from "back-end/src/enterprise";
import { runFreeFormQuery } from "back-end/src/services/datasource";
import { ReqContext } from "back-end/types/organization";
import { DataSourceInterface } from "back-end/types/datasource";

export async function getSavedQueries(req: AuthRequest, res: Response) {
  const context = getContextFromReq(req);

  if (!orgHasPremiumFeature(context.org, "saveSqlExplorerQueries")) {
    return res.status(200).json({
      status: 200,
      savedQueries: [],
    });
  }

  const savedQueries = await context.models.savedQueries.getAll();

  res.status(200).json({
    status: 200,
    savedQueries,
  });
}

export async function getSavedQuery(
  req: AuthRequest<null, { id: string }>,
  res: Response
) {
  const { id } = req.params;
  const context = getContextFromReq(req);

  if (!orgHasPremiumFeature(context.org, "saveSqlExplorerQueries")) {
    return res.status(404).json({
      status: 404,
      message: "Query not found",
    });
  }

  const savedQuery = await context.models.savedQueries.getById(id);

  if (!savedQuery) {
    return res.status(404).json({
      status: 404,
      message: "Query not found",
    });
  }

  res.status(200).json({
    status: 200,
    savedQuery,
  });
}

export async function postSavedQuery(
  req: AuthRequest<SavedQueryCreateProps>,
  res: Response
) {
  const {
    name,
    sql,
    datasourceId,
    results,
    dateLastRan,
    dataVizConfig,
  } = req.body;
  const context = getContextFromReq(req);

  if (!orgHasPremiumFeature(context.org, "saveSqlExplorerQueries")) {
    throw new Error("Your organization's plan does not support saving queries");
  }

  const datasource = await getDataSourceById(context, datasourceId);
  if (!datasource) {
    throw new Error("Cannot find datasource");
  }

  await context.models.savedQueries.create({
    name,
    sql,
    datasourceId,
    dateLastRan: getValidDate(dateLastRan),
    results,
    dataVizConfig,
  });
  res.status(200).json({
    status: 200,
  });
}

export async function putSavedQuery(
  req: AuthRequest<SavedQueryUpdateProps, { id: string }>,
  res: Response
) {
  const { id } = req.params;
  const context = getContextFromReq(req);

  if (!orgHasPremiumFeature(context.org, "saveSqlExplorerQueries")) {
    throw new Error("Your organization's plan does not support saving queries");
  }

  const updateData = {
    ...req.body,
    dateLastRan: req.body.dateLastRan
      ? getValidDate(req.body.dateLastRan)
      : undefined,
  };

  await context.models.savedQueries.updateById(id, updateData);
  res.status(200).json({
    status: 200,
  });
}

export async function refreshSavedQuery(
  req: AuthRequest<null, { id: string }>,
  res: Response
) {
  const { id } = req.params;
  const context = getContextFromReq(req);

  if (!orgHasPremiumFeature(context.org, "saveSqlExplorerQueries")) {
    throw new Error("Your organization's plan does not support saving queries");
  }

  const savedQuery = await context.models.savedQueries.getById(id);
  if (!savedQuery) {
    return res.status(404).json({
      status: 404,
      message: "Query not found",
    });
  }

  const datasource = await getDataSourceById(context, savedQuery.datasourceId);
  if (!datasource) {
    throw new Error("Cannot find datasource");
  }

  const debugResults = await executeAndSaveQuery(
    context,
    savedQuery,
    datasource
  );

  res.status(200).json({
    status: 200,
    debugResults,
  });
}

export async function deleteSavedQuery(
  req: AuthRequest<null, { id: string }>,
  res: Response
) {
  const { id } = req.params;
  const context = getContextFromReq(req);

  await context.models.savedQueries.deleteById(id);
  res.status(200).json({
    status: 200,
  });
}

export async function executeAndSaveQuery(
  context: ReqContext,
  savedQuery: SavedQuery,
  datasource: DataSourceInterface,
  limit: number = 1000
) {
  const { results, sql, duration, error } = await runFreeFormQuery(
    context,
    datasource,
    savedQuery.sql,
    limit
  );

  // Don't save if there was an error
  if (error || !results) {
    return {
      results: results,
      error,
      duration,
      sql,
    };
  }

  await context.models.savedQueries.update(savedQuery, {
    results: {
      results: results,
      error,
      duration,
      sql,
    },
    dateLastRan: new Date(),
  });
}
