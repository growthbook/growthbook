import type { Response } from "express";
import { canInlineFilterColumn } from "shared/experiments";
import { DEFAULT_MAX_METRIC_SLICE_LEVELS } from "shared/settings";
import { cloneDeep } from "lodash";
import { ReqContext } from "back-end/types/organization";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { getContextFromReq } from "back-end/src/services/organizations";
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
} from "back-end/types/fact-table";
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
import { DataSourceInterface } from "back-end/types/datasource";
import {
  runRefreshColumnsQuery,
  runColumnTopValuesQuery,
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
    data.columns = await runRefreshColumnsQuery(
      context,
      datasource,
      data as FactTableInterface,
    );

    if (!data.columns.length) {
      throw new Error("SQL did not return any rows");
    }
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
  req: AuthRequest<
    UpdateFactTableProps,
    { id: string },
    { forceColumnRefresh?: string; dim?: string }
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

  // Check if approval is required for this fact table update
  const approvalFlowSettings = context.org.settings?.approvalFlow?.factTables || [];
  const requiresApproval = approvalFlowSettings.some((setting) => {
    // Check if approval is enabled
    if (!setting.requireReviewOn) return false;

    // Check if this fact table's projects match the approval flow settings
    const factTableProjects = factTable.projects || [];
    const settingProjects = setting.projects || [];
    
    // If no projects specified in settings, applies to all
    if (settingProjects.length === 0) return true;
    
    // Check if any of the fact table's projects are in the approval settings
    return factTableProjects.some((p) => settingProjects.includes(p));
  });

  if (requiresApproval) {
    // Create an approval flow instead of directly updating
    const approvalFlow = await context.models.approvalFlow.create({
      entityType: "fact-table",
      entityId: factTable.id,
      title: `Update ${factTable.name}`,
      description: "Requesting approval for fact table changes",
      status: "pending-review",
      author: context.userId,
      reviews: [],
      proposedChanges: data,
      baseVersion: 0, // TODO: Add version tracking to fact tables
      activityLog: [], // Will be populated by beforeCreate hook
    });

    res.status(200).json({
      status: 200,
      requiresApproval: true,
      approvalFlow,
    } as any);

    await req.audit({
      event: "approvalFlow.create",
      entity: {
        object: "approvalFlow",
        id: approvalFlow.id,
      },
    });
  } else {
    // No approval required, update directly
    // Update the columns
    if (req.query?.forceColumnRefresh || needsColumnRefresh(data)) {
      const originalColumns = cloneDeep(factTable.columns || []);
      data.columns = await runRefreshColumnsQuery(context, datasource, {
        ...factTable,
        ...data,
      } as FactTableInterface);
      data.columnsError = null;

      if (!data.columns.some((col) => !col.deleted)) {
        throw new Error("SQL did not return any rows");
      }

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

    // If dim parameter is provided, refresh top values for that specific column
    if (req.query?.dim) {
      const columnName = req.query.dim;
      const column = factTable.columns.find((col) => col.column === columnName);

      if (
        column &&
        canInlineFilterColumn(factTable, column.column) &&
        column.datatype === "string"
      ) {
        try {
          const topValues = await runColumnTopValuesQuery(
            context,
            datasource,
            factTable,
            column,
          );

          const maxSliceLevels =
            context.org.settings?.maxMetricSliceLevels ??
            DEFAULT_MAX_METRIC_SLICE_LEVELS;
          const constrainedTopValues = topValues.slice(0, maxSliceLevels);

          // Update the column with new top values
          await updateColumn({
            factTable,
            column: column.column,
            changes: {
              topValues: constrainedTopValues,
            },
          });
        } catch (e) {
          logger.error(e, "Error running top values query for specific column", {
            column: columnName,
          });
        }
      }
    }

    await updateFactTable(context, factTable, data);

    await addTagsDiff(context.org.id, factTable.tags, data.tags || []);

    res.status(200).json({
      status: 200,
    });
  }
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
      runColumnTopValuesQuery(context, datasource, factTable, col)
        .then(async (values) => {
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
  req: AuthRequest<unknown>,
  res: Response<{ status: 200; factMetric: FactMetricInterface }>,
) => {
  const context = getContextFromReq(req);
  const data = context.models.factMetrics.createValidator.parse(req.body);

  const factMetric = await context.models.factMetrics.create(data);

  res.status(200).json({
    status: 200,
    factMetric,
  });
};

export const putFactMetric = async (
  req: AuthRequest<unknown, { id: string }>,
  res: Response<{ status: 200 }>,
) => {
  const context = getContextFromReq(req);
  const data = context.models.factMetrics.updateValidator.parse(req.body);

  // Get the current fact metric
  const factMetric = await context.models.factMetrics.getById(req.params.id);
  if (!factMetric) {
    throw new Error("Could not find fact metric");
  }

  // Check if approval is required for this fact metric update
  const approvalFlowSettings = context.org.settings?.approvalFlow?.metrics || [];
  // TODO: move this to its own function inside the approvals validator
  const requiresApproval = approvalFlowSettings.some((setting) => {
    // Check if approval is enabled
    if (!setting.requireReviewOn) return false;

    // Check if this fact metric's projects match the approval flow settings
    const metricProjects = factMetric.projects || [];
    const settingProjects = setting.projects || [];
    
    // If no projects specified in settings, applies to all
    if (settingProjects.length === 0) return true;
    
    // Check if any of the fact metric's projects are in the approval settings
    return metricProjects.some((p) => settingProjects.includes(p));
  });

  if (requiresApproval) {

    const approvalFlow = await context.models.approvalFlow.create({
      entityType: "fact-metric",
      entityId: factMetric.id,
      title: `Update ${factMetric.name}`,
      description: "Requesting approval for fact metric changes",
      status: "pending-review",
      author: context.userId,
      reviews: [],
      proposedChanges: data,
      baseVersion: 0, // TODO: Add version tracking to fact metrics
      activityLog: [], // Will be populated by beforeCreate hook
    });
    console.log("approvalFlow", approvalFlow);

    res.status(200).json({
      status: 200,
      requiresApproval: true,
      approvalFlow,
    } as any);

    await req.audit({
      event: "approvalFlow.create",
      entity: {
        object: "approvalFlow",
        id: approvalFlow.id,
      }
    });
  } else {
    // No approval required, update directly
    await context.models.factMetrics.updateById(req.params.id, data);

    res.status(200).json({
      status: 200,
    });
  }
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
