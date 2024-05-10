import type { Response } from "express";
import { ReqContext } from "../../../types/organization";
import { AuthRequest } from "../../types/AuthRequest";
import { getContextFromReq } from "../../services/organizations";
import {
  CreateFactFilterProps,
  CreateFactTableProps,
  FactMetricInterface,
  FactTableInterface,
  UpdateFactFilterProps,
  UpdateColumnProps,
  UpdateFactTableProps,
  TestFactFilterProps,
  FactFilterTestResults,
} from "../../../types/fact-table";
import {
  createFactTable,
  getAllFactTablesForOrganization,
  getFactTable,
  updateColumn,
  updateFactTable,
  deleteFactTable as deleteFactTableInDb,
  deleteFactFilter as deleteFactFilterInDb,
  createFactFilter,
  updateFactFilter,
} from "../../models/FactTableModel";
import { addTags, addTagsDiff } from "../../models/TagModel";
import { getSourceIntegrationObject } from "../../services/datasource";
import { getDataSourceById } from "../../models/DataSourceModel";
import { DataSourceInterface } from "../../../types/datasource";
import { runRefreshColumnsQuery } from "../../jobs/refreshFactTableColumns";

export const getFactTables = async (
  req: AuthRequest,
  res: Response<{ status: 200; factTables: FactTableInterface[] }>
) => {
  const context = getContextFromReq(req);

  const factTables = await getAllFactTablesForOrganization(context);

  res.status(200).json({
    status: 200,
    factTables,
  });
};

async function testFilterQuery(
  context: ReqContext,
  datasource: DataSourceInterface,
  factTable: FactTableInterface,
  filter: string
): Promise<FactFilterTestResults> {
  if (!context.permissions.canRunTestQueries(datasource)) {
    context.permissions.throwPermissionError();
  }

  const integration = getSourceIntegrationObject(context, datasource, true);

  if (!integration.getTestQuery || !integration.runTestQuery) {
    throw new Error("Testing not supported on this data source");
  }

  const sql = integration.getTestQuery(
    // Must have a newline after factTable sql in case it ends with a comment
    `SELECT * FROM (
      ${factTable.sql}
    ) f WHERE ${filter}`,
    {
      eventName: factTable.eventName,
    }
  );

  try {
    const results = await integration.runTestQuery(sql);
    return {
      sql,
      ...results,
    };
  } catch (e) {
    return {
      sql,
      error: e.message,
    };
  }
}

export const postFactTable = async (
  req: AuthRequest<CreateFactTableProps>,
  res: Response<{ status: 200; factTable: FactTableInterface }>
) => {
  const data = req.body;
  const context = getContextFromReq(req);

  if (!context.permissions.canCreateFactTable(data)) {
    context.permissions.throwPermissionError();
  }

  if (!data.datasource) {
    throw new Error("Must specify a data source for this fact table");
  }
  const datasource = await getDataSourceById(context, data.datasource);
  if (!datasource) {
    throw new Error("Could not find datasource");
  }

  data.columns = await runRefreshColumnsQuery(
    context,
    datasource,
    data as FactTableInterface
  );
  if (!data.columns.length) {
    throw new Error("SQL did not return any rows");
  }

  const factTable = await createFactTable(context, data);
  if (data.tags.length > 0) {
    await addTags(context.org.id, data.tags);
  }

  res.status(200).json({
    status: 200,
    factTable,
  });
};

export const putFactTable = async (
  req: AuthRequest<UpdateFactTableProps, { id: string }>,
  res: Response<{ status: 200 }>
) => {
  const data = req.body;
  const context = getContextFromReq(req);

  const factTable = await getFactTable(context, req.params.id);
  if (!factTable) {
    throw new Error("Could not find fact table with that id");
  }

  if (!context.permissions.canUpdateFactTable(factTable, data)) {
    context.permissions.throwPermissionError();
  }

  const datasource = await getDataSourceById(context, factTable.datasource);
  if (!datasource) {
    throw new Error("Could not find datasource");
  }

  // Update the columns
  data.columns = await runRefreshColumnsQuery(context, datasource, {
    ...factTable,
    ...data,
  } as FactTableInterface);
  data.columnsError = null;

  if (!data.columns.some((col) => !col.deleted)) {
    throw new Error("SQL did not return any rows");
  }

  await updateFactTable(context, factTable, data);

  await addTagsDiff(context.org.id, factTable.tags, data.tags || []);

  res.status(200).json({
    status: 200,
  });
};

export const deleteFactTable = async (
  req: AuthRequest<null, { id: string }>,
  res: Response<{ status: 200 }>
) => {
  const context = getContextFromReq(req);

  const factTable = await getFactTable(context, req.params.id);
  if (!factTable) {
    throw new Error("Could not find fact table with that id");
  }
  if (!context.permissions.canDeleteFactTable(factTable)) {
    context.permissions.throwPermissionError();
  }

  await deleteFactTableInDb(context, factTable);

  res.status(200).json({
    status: 200,
  });
};

export const putColumn = async (
  req: AuthRequest<UpdateColumnProps, { id: string; column: string }>,
  res: Response<{ status: 200 }>
) => {
  const data = req.body;
  const context = getContextFromReq(req);

  const factTable = await getFactTable(context, req.params.id);
  if (!factTable) {
    throw new Error("Could not find fact table with that id");
  }

  if (!context.permissions.canUpdateFactTable(factTable, {})) {
    context.permissions.throwPermissionError();
  }

  await updateColumn(factTable, req.params.column, data);

  res.status(200).json({
    status: 200,
  });
};

export const postFactFilterTest = async (
  req: AuthRequest<TestFactFilterProps, { id: string }>,
  res: Response<{
    status: 200;
    result: FactFilterTestResults;
  }>
) => {
  const data = req.body;
  const context = getContextFromReq(req);

  const factTable = await getFactTable(context, req.params.id);
  if (!factTable) {
    throw new Error("Could not find fact table with that id");
  }

  if (!context.permissions.canCreateAndUpdateFactFilter(factTable)) {
    context.permissions.throwPermissionError();
  }

  const datasource = await getDataSourceById(context, factTable.datasource);
  if (!datasource) {
    throw new Error("Could not find datasource");
  }

  const result = await testFilterQuery(
    context,
    datasource,
    factTable,
    data.value
  );

  res.status(200).json({
    status: 200,
    result,
  });
};

export const postFactFilter = async (
  req: AuthRequest<CreateFactFilterProps, { id: string }>,
  res: Response<{ status: 200; filterId: string }>
) => {
  const data = req.body;
  const context = getContextFromReq(req);

  const factTable = await getFactTable(context, req.params.id);
  if (!factTable) {
    throw new Error("Could not find fact table with that id");
  }

  if (!context.permissions.canCreateAndUpdateFactFilter(factTable)) {
    context.permissions.throwPermissionError();
  }

  const datasource = await getDataSourceById(context, factTable.datasource);
  if (!datasource) {
    throw new Error("Could not find datasource");
  }

  const filter = await createFactFilter(factTable, data);

  res.status(200).json({
    status: 200,
    filterId: filter.id,
  });
};

export const putFactFilter = async (
  req: AuthRequest<UpdateFactFilterProps, { id: string; filterId: string }>,
  res: Response<{ status: 200 }>
) => {
  const data = req.body;
  const context = getContextFromReq(req);

  const factTable = await getFactTable(context, req.params.id);
  if (!factTable) {
    throw new Error("Could not find fact table with that id");
  }

  if (!context.permissions.canCreateAndUpdateFactFilter(factTable)) {
    context.permissions.throwPermissionError();
  }

  await updateFactFilter(context, factTable, req.params.filterId, data);

  res.status(200).json({
    status: 200,
  });
};

export const deleteFactFilter = async (
  req: AuthRequest<null, { id: string; filterId: string }>,
  res: Response<{ status: 200 }>
) => {
  const context = getContextFromReq(req);

  const factTable = await getFactTable(context, req.params.id);
  if (!factTable) {
    throw new Error("Could not find filter table with that id");
  }
  if (!context.permissions.canDeleteFactFilter(factTable)) {
    context.permissions.throwPermissionError();
  }

  await deleteFactFilterInDb(context, factTable, req.params.filterId);

  res.status(200).json({
    status: 200,
  });
};

export const getFactMetrics = async (
  req: AuthRequest,
  res: Response<{ status: 200; factMetrics: FactMetricInterface[] }>
) => {
  const context = getContextFromReq(req);

  const factMetrics = await context.models.factMetrics.getAll();

  res.status(200).json({
    status: 200,
    factMetrics,
  });
};

export const postFactMetric = async (
  req: AuthRequest<unknown>,
  res: Response<{ status: 200; factMetric: FactMetricInterface }>
) => {
  const data = req.body;
  const context = getContextFromReq(req);

  const factMetric = await context.models.factMetrics.create(data);

  res.status(200).json({
    status: 200,
    factMetric,
  });
};

export const putFactMetric = async (
  req: AuthRequest<unknown, { id: string }>,
  res: Response<{ status: 200 }>
) => {
  const data = req.body;
  const context = getContextFromReq(req);

  await context.models.factMetrics.updateById(req.params.id, data);

  res.status(200).json({
    status: 200,
  });
};

export const deleteFactMetric = async (
  req: AuthRequest<null, { id: string }>,
  res: Response<{ status: 200 }>
) => {
  const context = getContextFromReq(req);

  await context.models.factMetrics.deleteById(req.params.id);

  res.status(200).json({
    status: 200,
  });
};
