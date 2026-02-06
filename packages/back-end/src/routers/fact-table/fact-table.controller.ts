import type { Response } from "express";
import { canInlineFilterColumn } from "shared/experiments";
import { DEFAULT_MAX_METRIC_SLICE_LEVELS } from "shared/settings";
import { cloneDeep } from "lodash";
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
  ColumnInterface,
  FactTableColumnType,
} from "shared/types/fact-table";
import { DataSourceInterface } from "shared/types/datasource";
import { CreateProps } from "shared/types/base-model";
import { ReqContext } from "back-end/types/request";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { getContextFromReq } from "back-end/src/services/organizations";
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
  cleanupMetricAutoSlices,
  detectRemovedColumns,
} from "back-end/src/models/FactTableModel";
import { addTags, addTagsDiff } from "back-end/src/models/TagModel";
import { getSourceIntegrationObject } from "back-end/src/services/datasource";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import {
  runRefreshColumnsQuery,
  runColumnsTopValuesQuery,
  populateAutoSlices,
  queueFactTableColumnsRefresh,
} from "back-end/src/jobs/refreshFactTableColumns";
import { logger } from "back-end/src/util/logger";
import { needsColumnRefresh } from "back-end/src/api/fact-tables/updateFactTable";

export const getFactTables = async (
  req: AuthRequest,
  res: Response<{ status: 200; factTables: FactTableInterface[] }>,
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
  filter: string,
): Promise<FactFilterTestResults> {
  if (!context.permissions.canRunTestQueries(datasource)) {
    context.permissions.throwPermissionError();
  }

  const integration = getSourceIntegrationObject(context, datasource, true);

  if (!integration.getTestQuery || !integration.runTestQuery) {
    throw new Error("Testing not supported on this data source");
  }

  const sql = integration.getTestQuery({
    // Must have a newline after factTable sql in case it ends with a comment
    query: `SELECT * FROM (
      ${factTable.sql}
    ) f WHERE ${filter}`,
    templateVariables: {
      eventName: factTable.eventName,
    },
    testDays: context.org.settings?.testQueryDays,
  });

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

// Helper to merge existing columns with new type map from LIMIT 0
function mergeColumnsWithTypeMap(
  existingColumns: ColumnInterface[],
  typeMap: Map<string, FactTableColumnType>
): ColumnInterface[] {
  const columns = cloneDeep(existingColumns);

  // Update existing columns
  columns.forEach((col) => {
    const type = typeMap.get(col.column);
    if (type === undefined) {
      col.deleted = true;
      col.dateUpdated = new Date();
    } else {
      if (col.deleted) {
        col.deleted = false;
        col.dateUpdated = new Date();
      }
      // Only update datatype if it was previously empty (preserve rich types)
      if (col.datatype === "" && type !== "") {
        col.datatype = type;
        col.dateUpdated = new Date();
      }
    }
  });

  // Add new columns
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



// Result type for the unified refreshColumns function
export type RefreshColumnsResult = {
  columns: ColumnInterface[];
  needsBackgroundRefresh: boolean; // True if LIMIT 0 was used and background job needed
};


/**
 * Unified function to refresh columns that handles both LIMIT 0 (fast) and LIMIT 20 (full) paths.
 * - For datasources supporting LIMIT 0: Returns basic columns from metadata, signals background refresh needed
 * - For other datasources: Returns full columns with type inference, no background refresh needed
 */
export async function refreshColumns(
  context: ReqContext,
  datasource: DataSourceInterface,
  factTable: Pick<
    FactTableInterface,
    "sql" | "eventName" | "columns" | "userIdTypes"
  >,
  forceColumnRefresh?: boolean
): Promise<RefreshColumnsResult> {
  if (!context.permissions.canRunFactQueries(datasource)) {
    context.permissions.throwPermissionError();
  }

  const integration = getSourceIntegrationObject(context, datasource, true);

  if (!integration.getTestQuery || !integration.runTestQuery) {
    throw new Error("Testing not supported on this data source");
  }

  // Check if datasource supports LIMIT 0 for fast column metadata
  if (!forceColumnRefresh && integration.supportsLimitZeroColumnValidation?.()) {
    // Fast path: LIMIT 0 query
    const sql = integration.getTestQuery({
      query: factTable.sql,
      templateVariables: { eventName: factTable.eventName },
      testDays: context.org.settings?.testQueryDays,
      limit: 0,
    });

    const result = await integration.runTestQuery(sql, ["timestamp"]);

    if (!result.columns?.length) {
      throw new Error("SQL did not return any columns");
    }

    // Build type map from metadata (includes "json" without fields)
    const typeMap = new Map<string, FactTableColumnType>();
    result.columns.forEach((col) => {
      typeMap.set(col.name, col.dataType || "");
    });

    // Merge with existing columns (preserve rich types like json with jsonFields)
    const columns = mergeColumnsWithTypeMap(factTable.columns || [], typeMap);

    return { columns, needsBackgroundRefresh: true };
  } else {
    // Slow path: Full LIMIT 20 query (existing behavior)
    const columns = await runRefreshColumnsQuery(context, datasource, factTable);
    return { columns, needsBackgroundRefresh: false };
  }
}


export const postFactTable = async (
  req: AuthRequest<CreateFactTableProps>,
  res: Response<{ status: 200; factTable: FactTableInterface }>,
) => {
  const data = req.body;
  const context = getContextFromReq(req);

  if (!data.datasource) {
    throw new Error("Must specify a data source for this fact table");
  }
  const datasource = await getDataSourceById(context, data.datasource);
  if (!datasource) {
    throw new Error("Could not find datasource");
  }

  if (!data.columns?.length) {
    const { columns, needsBackgroundRefresh } = await refreshColumns(
      context,
      datasource,
      data as FactTableInterface
    );

    if (!columns.length) {
      throw new Error("SQL did not return any columns");
    }

    data.columns = columns;
    data.columnRefreshPending = needsBackgroundRefresh || undefined;
  }

  const factTable = await createFactTable(context, data);

  if (data.columnRefreshPending) {
    await queueFactTableColumnsRefresh(factTable);
  }
  if (data.tags.length > 0) {
    await addTags(context.org.id, data.tags);
  }

  res.status(200).json({
    status: 200,
    factTable,
  });
};

export const putFactTable = async (
  req: AuthRequest<
    UpdateFactTableProps,
    { id: string },
    { forceColumnRefresh?: string }
  >,
  res: Response<{ status: 200 }>,
) => {
  const data = req.body;
  const context = getContextFromReq(req);

  const factTable = await getFactTable(context, req.params.id);
  if (!factTable) {
    throw new Error("Could not find fact table with that id");
  }

  const datasource = await getDataSourceById(context, factTable.datasource);
  if (!datasource) {
    throw new Error("Could not find datasource");
  }

  const forceColumnRefresh = req.query?.forceColumnRefresh === "true";

  // Update the columns
  if (req.query?.forceColumnRefresh || needsColumnRefresh(data)) {
    const originalColumns = cloneDeep(factTable.columns || []);
    const { columns, needsBackgroundRefresh } = await refreshColumns(
      context,
      datasource,
      { ...factTable, ...data } as FactTableInterface,
      forceColumnRefresh
    );

    if (!columns.some((col) => !col.deleted)) {
      throw new Error("SQL did not return any columns");
    }

    data.columns = columns;
    data.columnsError = null;
    data.columnRefreshPending = needsBackgroundRefresh || undefined;

    // Check for removed columns and trigger cleanup
    const removedColumns = detectRemovedColumns(originalColumns, data.columns);

    if (removedColumns.length > 0) {
      await cleanupMetricAutoSlices({
        context,
        factTableId: factTable.id,
        removedColumns,
      });
    }
  }

  await updateFactTable(context, factTable, data);

  if (data.columnRefreshPending) {
    await queueFactTableColumnsRefresh({
      ...factTable,
      ...data,
    } as FactTableInterface);
  }

  await addTagsDiff(context.org.id, factTable.tags, data.tags || []);

  res.status(200).json({
    status: 200,
  });
};

export const archiveFactTable = async (
  req: AuthRequest<unknown, { id: string }>,
  res: Response<{ status: 200 }>,
) => {
  const context = getContextFromReq(req);

  const factTable = await getFactTable(context, req.params.id);
  if (!factTable) {
    throw new Error("Could not find fact table with that id");
  }

  if (!context.permissions.canUpdateFactTable(factTable, { archived: true })) {
    context.permissions.throwPermissionError();
  }

  await updateFactTable(context, factTable, { archived: true });

  res.status(200).json({
    status: 200,
  });
};

export const unarchiveFactTable = async (
  req: AuthRequest<unknown, { id: string }>,
  res: Response<{ status: 200 }>,
) => {
  const context = getContextFromReq(req);

  const factTable = await getFactTable(context, req.params.id);
  if (!factTable) {
    throw new Error("Could not find fact table with that id");
  }

  if (!context.permissions.canUpdateFactTable(factTable, { archived: false })) {
    context.permissions.throwPermissionError();
  }

  await updateFactTable(context, factTable, { archived: false });

  res.status(200).json({
    status: 200,
  });
};

export const deleteFactTable = async (
  req: AuthRequest<null, { id: string }>,
  res: Response<{ status: 200 }>,
) => {
  const context = getContextFromReq(req);

  const factTable = await getFactTable(context, req.params.id);
  if (!factTable) {
    throw new Error("Could not find fact table with that id");
  }

  // check if for fact segments using this before deleting
  const segments = await context.models.segments.getByFactTableId(factTable.id);

  if (segments.length) {
    throw new Error(
      `The following segments are defined via this fact table: ${segments.map(
        (segment) => `\n - ${segment.name}`,
      )}`,
    );
  }

  await deleteFactTableInDb(context, factTable);

  res.status(200).json({
    status: 200,
  });
};

export const postColumnTopValues = async (
  req: AuthRequest<
    unknown,
    { id: string; column: string },
    { forceAutoSlice?: string }
  >,
  res: Response<{ status: 200 }>,
) => {
  const context = getContextFromReq(req);

  const factTable = await getFactTable(context, req.params.id);
  if (!factTable) {
    throw new Error("Could not find fact table with that id");
  }

  if (!context.permissions.canUpdateFactTable(factTable, { columns: [] })) {
    context.permissions.throwPermissionError();
  }

  const datasource = await getDataSourceById(context, factTable.datasource);
  if (!datasource) {
    throw new Error("Could not find datasource");
  }

  const databaseColumn = factTable.columns.find(
    (col) => col.column === req.params.column,
  );
  if (!databaseColumn) {
    throw new Error("Could not find column");
  }

  // forceAutoSlice allows fetching when the front end demands top values
  // even if the column is not yet set as a auto slice column in the database.
  const forceAutoSlice = req.query?.forceAutoSlice === "true";

  const column: ColumnInterface = forceAutoSlice
    ? {
        ...databaseColumn,
        isAutoSliceColumn: true,
        datatype: "string",
      }
    : databaseColumn;

  if (
    forceAutoSlice ||
    ((column.alwaysInlineFilter || column.isAutoSliceColumn) &&
      canInlineFilterColumn(factTable, column.column) &&
      column.datatype === "string")
  ) {
    try {
      const topValuesByColumn = await runColumnsTopValuesQuery(
        context,
        datasource,
        factTable,
        [column],
      );

      const topValues = topValuesByColumn[column.column] || [];
      const maxSliceLevels =
        context.org.settings?.maxMetricSliceLevels ??
        DEFAULT_MAX_METRIC_SLICE_LEVELS;

      const changes: UpdateColumnProps = {
        topValues,
      };

      if (column.isAutoSliceColumn) {
        changes.autoSlices = populateAutoSlices(
          column,
          topValues,
          maxSliceLevels,
        );
      }

      // Update the column with new top values
      await updateColumn({
        context,
        factTable,
        column: column.column,
        changes,
      });
    } catch (e) {
      logger.error(e, "Error running top values query for specific column", {
        column: req.params.column,
      });
      throw e;
    }
  } else {
    throw new Error(
      "Column does not meet requirements for top values refresh (must be string type and have alwaysInlineFilter or isAutoSliceColumn enabled)",
    );
  }

  res.status(200).json({
    status: 200,
  });
};

export const putColumn = async (
  req: AuthRequest<UpdateColumnProps, { id: string; column: string }>,
  res: Response<{ status: 200 }>,
) => {
  const data = req.body;
  const context = getContextFromReq(req);

  const factTable = await getFactTable(context, req.params.id);
  if (!factTable) {
    throw new Error("Could not find fact table with that id");
  }

  if (!context.permissions.canUpdateFactTable(factTable, { columns: [] })) {
    context.permissions.throwPermissionError();
  }

  const col = factTable.columns.find((c) => c.column === req.params.column);
  if (!col) {
    throw new Error("Could not find column");
  }

  if (!data.name) {
    data.name = col.column;
  }

  // Check enterprise feature access for dimension properties
  if (data.isAutoSliceColumn) {
    if (!context.hasPremiumFeature("metric-slices")) {
      throw new Error("Metric slices require an enterprise license");
    }
  }

  const updatedCol = { ...col, ...data };

  // If we're just toggling prompting on, populate values
  if (
    !col.alwaysInlineFilter &&
    data.alwaysInlineFilter &&
    canInlineFilterColumn(factTable, updatedCol.column) &&
    updatedCol.datatype === "string"
  ) {
    const datasource = await getDataSourceById(context, factTable.datasource);
    if (!datasource) {
      throw new Error("Could not find datasource");
    }

    if (context.permissions.canRunFactQueries(datasource)) {
      runColumnsTopValuesQuery(context, datasource, factTable, [col])
        .then(async (topValuesByColumn) => {
          const values = topValuesByColumn[col.column] || [];
          if (!values.length) return;
          await updateColumn({
            factTable,
            column: col.column,
            changes: {
              topValues: values,
            },
          });
        })
        .catch((e) => {
          logger.warn("Failed to get top values for column", e);
        });
    }
  }

  await updateColumn({
    context,
    factTable,
    column: req.params.column,
    changes: data,
  });

  res.status(200).json({
    status: 200,
  });
};

export const postFactFilterTest = async (
  req: AuthRequest<TestFactFilterProps, { id: string }>,
  res: Response<{
    status: 200;
    result: FactFilterTestResults;
  }>,
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
    data.value,
  );

  res.status(200).json({
    status: 200,
    result,
  });
};

export const postFactFilter = async (
  req: AuthRequest<CreateFactFilterProps, { id: string }>,
  res: Response<{ status: 200; filterId: string }>,
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
  res: Response<{ status: 200 }>,
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
  res: Response<{ status: 200 }>,
) => {
  const context = getContextFromReq(req);

  const factTable = await getFactTable(context, req.params.id);
  if (!factTable) {
    throw new Error("Could not find filter table with that id");
  }
  if (!context.permissions.canDeleteFactFilter(factTable)) {
    context.permissions.throwPermissionError();
  }

  //Before deleting a fact filter, check if it's used by a fact segment
  const segments = (
    await context.models.segments.getByFactTableId(factTable.id)
  ).filter((segment) => segment.filters?.includes(req.params.filterId));

  if (segments.length) {
    throw new Error(
      `The following segments are using this filter: ${segments.map(
        (segment) => `\n - ${segment.name}`,
      )}`,
    );
  }

  await deleteFactFilterInDb(context, factTable, req.params.filterId);

  res.status(200).json({
    status: 200,
  });
};

export const getFactMetrics = async (
  req: AuthRequest,
  res: Response<{ status: 200; factMetrics: FactMetricInterface[] }>,
) => {
  const context = getContextFromReq(req);

  const factMetrics = await context.models.factMetrics.getAll();

  res.status(200).json({
    status: 200,
    factMetrics,
  });
};

export const postFactMetric = async (
  req: AuthRequest<CreateProps<FactMetricInterface>>,
  res: Response<{ status: 200; factMetric: FactMetricInterface }>,
) => {
  const context = getContextFromReq(req);

  const factMetric = await context.models.factMetrics.create(req.body);

  res.status(200).json({
    status: 200,
    factMetric,
  });
};

export const putFactMetric = async (
  req: AuthRequest<Partial<FactMetricInterface>, { id: string }>,
  res: Response<{ status: 200 }>,
) => {
  const context = getContextFromReq(req);

  await context.models.factMetrics.updateById(req.params.id, req.body);

  res.status(200).json({
    status: 200,
  });
};

export const deleteFactMetric = async (
  req: AuthRequest<null, { id: string }>,
  res: Response<{ status: 200 }>,
) => {
  const context = getContextFromReq(req);

  await context.models.factMetrics.deleteById(req.params.id);

  res.status(200).json({
    status: 200,
  });
};
