import { Response } from "express";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { TestQueryRow } from "back-end/src/types/Integration";
import { getContextFromReq } from "back-end/src/services/organizations";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { createSavedQuery } from "back-end/src/models/SavedQueryModel";

export async function getSavedQueries(req: AuthRequest, res: Response) {
  res.status(200).json({
    status: 200,
  });
}

export async function getSavedQuery(
  req: AuthRequest<null, { id: string }>,
  res: Response
) {
  res.status(200).json({
    status: 200,
  });
}

export async function postSavedQuery(
  req: AuthRequest<{
    name: string;
    description?: string;
    sql: string;
    datasourceId: string;
    results?: TestQueryRow[];
  }>,
  res: Response
) {
  const { name, description, sql, datasourceId, results } = req.body;
  const context = getContextFromReq(req);

  const datasource = await getDataSourceById(context, datasourceId);
  if (!datasource) {
    throw new Error("Cannot find datasource");
  }

  if (!context.permissions.canCreateSavedQueries(datasource)) {
    context.permissions.throwPermissionError();
  }

  const { org } = context;

  try {
    await createSavedQuery({
      name,
      organization: org.id,
      description,
      sql,
      datasourceId,
      results,
      dateLastRan: results && results.length > 0 ? new Date() : undefined,
    });
    res.status(200).json({
      status: 200,
    });
  } catch (error) {
    res.status(500).json({
      status: 500,
      message: `Failed to create saved query: ${error}`,
    });
  }
}

export async function putSavedQuery(
  req: AuthRequest<
    {
      name?: string;
      description?: string;
      sql?: string;
      datasourceId?: string;
    },
    { id: string }
  >,
  res: Response
) {
  res.status(200).json({
    status: 200,
  });
}

export async function deleteSavedQuery(
  req: AuthRequest<null, { id: string }>,
  res: Response
) {
  res.status(200).json({
    status: 200,
  });
}
