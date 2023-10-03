import type { Response } from "express";
import { AuthRequest } from "../../types/AuthRequest";
import { getOrgFromReq } from "../../services/organizations";
import {
  CreateFactFilterProps,
  CreateFactMetricProps,
  CreateFactProps,
  CreateFactTableProps,
  FactMetricInterface,
  FactTableColumn,
  FactTableInterface,
  UpdateFactFilterProps,
  UpdateFactMetricProps,
  UpdateFactProps,
  UpdateFactTableProps,
} from "../../../types/fact-table";
import {
  createFact,
  createFactTable,
  getAllFactTablesForOrganization,
  getFactTable,
  updateFact,
  updateFactTable,
  deleteFactTable as deleteFactTableInDb,
  deleteFact as deleteFactInDb,
  deleteFactFilter as deleteFactFilterInDb,
  createFactFilter,
  updateFactFilter,
} from "../../models/FactTableModel";
import { addTags, addTagsDiff } from "../../models/TagModel";
import {
  createFactMetric,
  getAllFactMetricsForOrganization,
  getFactMetric,
  updateFactMetric,
  deleteFactMetric as deleteFactMetricInDb,
} from "../../models/FactMetricModel";
import { getSourceIntegrationObject } from "../../services/datasource";
import { getDataSourceById } from "../../models/DataSourceModel";
import { DataSourceInterface } from "../../../types/datasource";
import { determineColumnTypes } from "../../util/sql";

export const getFactTables = async (
  req: AuthRequest,
  res: Response<{ status: 200; factTables: FactTableInterface[] }>
) => {
  const { org } = getOrgFromReq(req);

  const factTables = await getAllFactTablesForOrganization(org.id);

  res.status(200).json({
    status: 200,
    factTables,
  });
};

async function getColumns(
  datasource: DataSourceInterface,
  factTable: Pick<FactTableInterface, "sql" | "eventName">
): Promise<FactTableColumn[]> {
  const integration = getSourceIntegrationObject(datasource, true);

  if (!integration.getTestQuery || !integration.runTestQuery) {
    throw new Error("Testing not supported on this data source");
  }

  const sql = integration.getTestQuery(factTable.sql, {
    eventName: factTable.eventName,
  });

  const result = await integration.runTestQuery(sql);
  return determineColumnTypes(result.results);
}

export const postFactTable = async (
  req: AuthRequest<CreateFactTableProps>,
  res: Response<{ status: 200; factTable: FactTableInterface }>
) => {
  const data = req.body;
  const { org } = getOrgFromReq(req);

  req.checkPermissions("manageFactTables", data.projects || "");

  if (!data.datasource) {
    throw new Error("Must specify a data source for this fact table");
  }
  const datasource = await getDataSourceById(data.datasource, org.id);
  if (!datasource) {
    throw new Error("Could not find datasource");
  }

  req.checkPermissions("runQueries", datasource.projects || "");

  data.columns = await getColumns(datasource, data);

  const factTable = await createFactTable(org.id, data);

  if (data.tags.length > 0) {
    await addTags(org.id, data.tags);
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
  const { org } = getOrgFromReq(req);

  const factTable = await getFactTable(org.id, req.params.id);
  if (!factTable) {
    throw new Error("Could not find fact table with that id");
  }

  // Check permissions for both the existing projects and new ones (if they are being changed)
  req.checkPermissions("manageFactTables", factTable.projects);
  if (data.projects) {
    req.checkPermissions("manageFactTables", data.projects || "");
  }

  const datasource = await getDataSourceById(factTable.datasource, org.id);
  if (!datasource) {
    throw new Error("Could not find datasource");
  }
  req.checkPermissions("runQueries", datasource.projects || "");

  // Update the columns
  data.columns = await getColumns(datasource, { ...factTable, ...data });

  await updateFactTable(factTable, data);

  await addTagsDiff(org.id, factTable.tags, data.tags || []);

  res.status(200).json({
    status: 200,
  });
};

export const deleteFactTable = async (
  req: AuthRequest<null, { id: string }>,
  res: Response<{ status: 200 }>
) => {
  const { org } = getOrgFromReq(req);

  const factTable = await getFactTable(org.id, req.params.id);
  if (!factTable) {
    throw new Error("Could not find fact table with that id");
  }
  req.checkPermissions("manageFactTables", factTable.projects);

  await deleteFactTableInDb(factTable);

  res.status(200).json({
    status: 200,
  });
};

export const postFact = async (
  req: AuthRequest<CreateFactProps, { id: string }>,
  res: Response<{ status: 200; factId: string }>
) => {
  const data = req.body;
  const { org } = getOrgFromReq(req);

  const factTable = await getFactTable(org.id, req.params.id);
  if (!factTable) {
    throw new Error("Could not find fact table with that id");
  }

  req.checkPermissions("manageFactTables", factTable.projects);

  const fact = await createFact(factTable, data);

  res.status(200).json({
    status: 200,
    factId: fact.id,
  });
};

export const putFact = async (
  req: AuthRequest<UpdateFactProps, { id: string; factId: string }>,
  res: Response<{ status: 200 }>
) => {
  const data = req.body;
  const { org } = getOrgFromReq(req);

  const factTable = await getFactTable(org.id, req.params.id);
  if (!factTable) {
    throw new Error("Could not find fact table with that id");
  }

  req.checkPermissions("manageFactTables", factTable.projects);

  await updateFact(factTable, req.params.factId, data);

  res.status(200).json({
    status: 200,
  });
};

export const deleteFact = async (
  req: AuthRequest<null, { id: string; factId: string }>,
  res: Response<{ status: 200 }>
) => {
  const { org } = getOrgFromReq(req);

  const factTable = await getFactTable(org.id, req.params.id);
  if (!factTable) {
    throw new Error("Could not find fact table with that id");
  }
  req.checkPermissions("manageFactTables", factTable.projects);

  await deleteFactInDb(factTable, req.params.factId);

  res.status(200).json({
    status: 200,
  });
};

export const postFactFilter = async (
  req: AuthRequest<CreateFactFilterProps, { id: string }>,
  res: Response<{ status: 200; filterId: string }>
) => {
  const data = req.body;
  const { org } = getOrgFromReq(req);

  const factTable = await getFactTable(org.id, req.params.id);
  if (!factTable) {
    throw new Error("Could not find fact table with that id");
  }

  req.checkPermissions("manageFactTables", factTable.projects);

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
  const { org } = getOrgFromReq(req);

  const factTable = await getFactTable(org.id, req.params.id);
  if (!factTable) {
    throw new Error("Could not find fact table with that id");
  }

  req.checkPermissions("manageFactTables", factTable.projects);

  await updateFactFilter(factTable, req.params.filterId, data);

  res.status(200).json({
    status: 200,
  });
};

export const deleteFactFilter = async (
  req: AuthRequest<null, { id: string; filterId: string }>,
  res: Response<{ status: 200 }>
) => {
  const { org } = getOrgFromReq(req);

  const factTable = await getFactTable(org.id, req.params.id);
  if (!factTable) {
    throw new Error("Could not find filter table with that id");
  }
  req.checkPermissions("manageFactTables", factTable.projects);

  await deleteFactFilterInDb(factTable, req.params.filterId);

  res.status(200).json({
    status: 200,
  });
};

export const getFactMetrics = async (
  req: AuthRequest,
  res: Response<{ status: 200; factMetrics: FactMetricInterface[] }>
) => {
  const { org } = getOrgFromReq(req);

  const factMetrics = await getAllFactMetricsForOrganization(org.id);

  res.status(200).json({
    status: 200,
    factMetrics,
  });
};

export const postFactMetric = async (
  req: AuthRequest<CreateFactMetricProps>,
  res: Response<{ status: 200; factMetric: FactMetricInterface }>
) => {
  const data = req.body;
  const { org } = getOrgFromReq(req);

  req.checkPermissions("createMetrics", data.projects || "");

  const factMetric = await createFactMetric(org.id, data);

  if (data.tags.length > 0) {
    await addTags(org.id, data.tags);
  }

  res.status(200).json({
    status: 200,
    factMetric,
  });
};

export const putFactMetric = async (
  req: AuthRequest<UpdateFactMetricProps, { id: string }>,
  res: Response<{ status: 200 }>
) => {
  const data = req.body;
  const { org } = getOrgFromReq(req);

  const factMetric = await getFactMetric(org.id, req.params.id);
  if (!factMetric) {
    throw new Error("Could not find fact metric with that id");
  }

  // Check permissions for both the existing projects and new ones (if they are being changed)
  req.checkPermissions("createMetrics", factMetric.projects);
  if (data.projects) {
    req.checkPermissions("createMetrics", data.projects || "");
  }

  await updateFactMetric(factMetric, data);

  await addTagsDiff(org.id, factMetric.tags, data.tags || []);

  res.status(200).json({
    status: 200,
  });
};

export const deleteFactMetric = async (
  req: AuthRequest<null, { id: string }>,
  res: Response<{ status: 200 }>
) => {
  const { org } = getOrgFromReq(req);

  const factMetric = await getFactMetric(org.id, req.params.id);
  if (!factMetric) {
    throw new Error("Could not find fact metric with that id");
  }
  req.checkPermissions("createMetrics", factMetric.projects);

  await deleteFactMetricInDb(factMetric);

  res.status(200).json({
    status: 200,
  });
};
