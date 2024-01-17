import type { Response } from "express";
import { AuthRequest } from "../../types/AuthRequest";
import { getContextFromReq } from "../../services/organizations";
import {
  CreateFactFilterProps,
  CreateFactMetricProps,
  CreateFactTableProps,
  FactMetricInterface,
  ColumnInterface,
  FactTableInterface,
  UpdateFactFilterProps,
  UpdateFactMetricProps,
  UpdateColumnProps,
  UpdateFactTableProps,
  FactTableColumnType,
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
  const { org } = await getContextFromReq(req);

  const factTables = await getAllFactTablesForOrganization(org.id);

  res.status(200).json({
    status: 200,
    factTables,
  });
};

async function testFilterQuery(
  datasource: DataSourceInterface,
  factTable: FactTableInterface,
  filter: string
): Promise<FactFilterTestResults> {
  const integration = getSourceIntegrationObject(datasource, true);

  if (!integration.getTestQuery || !integration.runTestQuery) {
    throw new Error("Testing not supported on this data source");
  }

  const sql = integration.getTestQuery(
    `SELECT * FROM (${factTable.sql}) f WHERE ${filter}`,
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

async function updateColumns(
  datasource: DataSourceInterface,
  factTable: Pick<FactTableInterface, "sql" | "eventName" | "columns">
): Promise<ColumnInterface[]> {
  const integration = getSourceIntegrationObject(datasource, true);

  if (!integration.getTestQuery || !integration.runTestQuery) {
    throw new Error("Testing not supported on this data source");
  }

  const sql = integration.getTestQuery(factTable.sql, {
    eventName: factTable.eventName,
  });

  const result = await integration.runTestQuery(sql, ["timestamp"]);

  const typeMap = new Map<string, FactTableColumnType>();
  determineColumnTypes(result.results).forEach((col) => {
    typeMap.set(col.column, col.datatype);
  });

  const columns = factTable.columns || [];

  // Update existing column
  columns.forEach((col) => {
    const type = typeMap.get(col.column);

    // Column no longer exists, mark as deleted
    if (type === undefined) {
      col.deleted = true;
      col.dateUpdated = new Date();
    }
    // Column exists
    else {
      if (col.deleted) {
        col.deleted = false;
        col.dateUpdated = new Date();
      }

      // If we now know the datatype, update it
      if (col.datatype === "" && type !== "") {
        col.datatype = type;
        col.dateUpdated = new Date();
      }
    }
  });

  // Add new columns that don't exist yet
  typeMap.forEach((datatype, column) => {
    if (!columns.some((c) => c.column === column)) {
      columns.push({
        column,
        datatype,
        dateCreated: new Date(),
        dateUpdated: new Date(),
        description: "",
        name: column,
        numberFormat: "",
        deleted: false,
      });
    }
  });

  return columns;
}

export const postFactTable = async (
  req: AuthRequest<CreateFactTableProps>,
  res: Response<{ status: 200; factTable: FactTableInterface }>
) => {
  const data = req.body;
  const { org } = await getContextFromReq(req);

  req.checkPermissions("manageFactTables", data.projects || "");

  if (!data.datasource) {
    throw new Error("Must specify a data source for this fact table");
  }
  const datasource = await getDataSourceById(data.datasource, org.id);
  if (!datasource) {
    throw new Error("Could not find datasource");
  }

  req.checkPermissions("runQueries", datasource.projects || "");

  data.columns = await updateColumns(datasource, data as FactTableInterface);

  if (!data.columns.length) {
    throw new Error("SQL did not return any rows");
  }

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
  const { org } = await getContextFromReq(req);

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
  data.columns = await updateColumns(datasource, {
    ...factTable,
    ...data,
  } as FactTableInterface);

  if (!data.columns.some((col) => !col.deleted)) {
    throw new Error("SQL did not return any rows");
  }

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
  const { org } = await getContextFromReq(req);

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

export const putColumn = async (
  req: AuthRequest<UpdateColumnProps, { id: string; column: string }>,
  res: Response<{ status: 200 }>
) => {
  const data = req.body;
  const { org } = await getContextFromReq(req);

  const factTable = await getFactTable(org.id, req.params.id);
  if (!factTable) {
    throw new Error("Could not find fact table with that id");
  }

  req.checkPermissions("manageFactTables", factTable.projects);

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
  const { org } = await getContextFromReq(req);

  const factTable = await getFactTable(org.id, req.params.id);
  if (!factTable) {
    throw new Error("Could not find fact table with that id");
  }

  req.checkPermissions("manageFactTables", factTable.projects);

  const datasource = await getDataSourceById(factTable.datasource, org.id);
  if (!datasource) {
    throw new Error("Could not find datasource");
  }
  req.checkPermissions("runQueries", datasource.projects || "");

  const result = await testFilterQuery(datasource, factTable, data.value);

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
  const { org } = await getContextFromReq(req);

  const factTable = await getFactTable(org.id, req.params.id);
  if (!factTable) {
    throw new Error("Could not find fact table with that id");
  }

  req.checkPermissions("manageFactTables", factTable.projects);

  const datasource = await getDataSourceById(factTable.datasource, org.id);
  if (!datasource) {
    throw new Error("Could not find datasource");
  }
  req.checkPermissions("runQueries", datasource.projects || "");

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
  const { org } = await getContextFromReq(req);

  const factTable = await getFactTable(org.id, req.params.id);
  if (!factTable) {
    throw new Error("Could not find fact table with that id");
  }

  req.checkPermissions("manageFactTables", factTable.projects);

  // If the filter SQL is changing, re-test the query
  const existingFilter = factTable.filters.find(
    (f) => f.id === req.params.filterId
  );
  if (existingFilter && existingFilter.value !== data.value) {
    const datasource = await getDataSourceById(factTable.datasource, org.id);
    if (!datasource) {
      throw new Error("Could not find datasource");
    }
    req.checkPermissions("runQueries", datasource.projects || "");
  }

  await updateFactFilter(factTable, req.params.filterId, data);

  res.status(200).json({
    status: 200,
  });
};

export const deleteFactFilter = async (
  req: AuthRequest<null, { id: string; filterId: string }>,
  res: Response<{ status: 200 }>
) => {
  const { org } = await getContextFromReq(req);

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
  const { org } = await getContextFromReq(req);

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
  const { org } = await getContextFromReq(req);

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
  const { org } = await getContextFromReq(req);

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
  const { org } = await getContextFromReq(req);

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
