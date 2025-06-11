import { Response } from "express";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { TestQueryRow } from "back-end/src/types/Integration";
import { getContextFromReq } from "back-end/src/services/organizations";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { DataVizConfig } from "back-end/src/validators/saved-queries";

export async function getSavedQueries(req: AuthRequest, res: Response) {
  const context = getContextFromReq(req);

  try {
    const savedQueries = await context.models.savedQueries.getAll();

    res.status(200).json({
      status: 200,
      savedQueries,
    });
  } catch (error) {
    res.status(500).json({
      status: 500,
      message: `Failed to fetch saved queries: ${error}`,
    });
  }
}

export async function postSavedQuery(
  req: AuthRequest<{
    name: string;
    sql: string;
    datasourceId: string;
    results: TestQueryRow[];
    dateLastRan: string;
    dataVizConfig?: DataVizConfig;
  }>,
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

  const datasource = await getDataSourceById(context, datasourceId);
  if (!datasource) {
    throw new Error("Cannot find datasource");
  }

  try {
    await context.models.savedQueries.create({
      name,
      sql,
      datasourceId,
      dateLastRan: new Date(dateLastRan),
      results,
      dataVizConfig,
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
      sql?: string;
      datasourceId?: string;
      results?: TestQueryRow[];
      dateLastRan?: string;
      dataVizConfig?: DataVizConfig;
    },
    { id: string }
  >,
  res: Response
) {
  const { id } = req.params;
  const {
    name,
    sql,
    datasourceId,
    results,
    dateLastRan,
    dataVizConfig,
  } = req.body;
  const context = getContextFromReq(req);

  const savedQuery = await context.models.savedQueries.getById(id);
  if (!savedQuery) {
    throw new Error("Cannot find saved query");
  }

  try {
    const updateData: Partial<{
      name: string;
      description: string;
      sql: string;
      datasourceId: string;
      dateLastRan: Date;
      results: TestQueryRow[];
      dataVizConfig: DataVizConfig;
    }> = {};

    if (name !== undefined) updateData.name = name;
    if (sql !== undefined) updateData.sql = sql;
    if (datasourceId !== undefined) updateData.datasourceId = datasourceId;
    if (results !== undefined) updateData.results = results;
    if (dateLastRan !== undefined)
      updateData.dateLastRan = new Date(dateLastRan);
    if (dataVizConfig !== undefined) updateData.dataVizConfig = dataVizConfig;

    await context.models.savedQueries.updateById(id, updateData);
    res.status(200).json({
      status: 200,
    });
  } catch (error) {
    res.status(500).json({
      status: 500,
      message: `Failed to update saved query: ${error}`,
    });
  }
}

export async function deleteSavedQuery(
  req: AuthRequest<null, { id: string }>,
  res: Response
) {
  const { id } = req.params;
  const context = getContextFromReq(req);

  try {
    await context.models.savedQueries.deleteById(id);
    res.status(200).json({
      status: 200,
    });
  } catch (error) {
    res.status(500).json({
      status: 500,
      message: `Failed to delete saved query: ${error}`,
    });
  }
}
