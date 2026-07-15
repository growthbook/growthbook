import type { Response } from "express";
import {
  canInlineFilterColumn,
  expandVirtualColumnsInSql,
  revalidateVirtualColumns,
} from "shared/experiments";
import { DEFAULT_MAX_METRIC_SLICE_LEVELS } from "shared/settings";
import { cloneDeep } from "lodash";
import {
  CreateColumnProps,
  CreateFactFilterProps,
  CreateFactTableProps,
  FactMetricInterface,
  FactTableInterface,
  UpdateFactFilterProps,
  UpdateColumnProps,
  UpdateFactTableProps,
  TestFactFilterProps,
  TestVirtualColumnProps,
  FactFilterTestResults,
  ColumnInterface,
  FactTableColumnType,
} from "shared/types/fact-table";
import { DataSourceInterface } from "shared/types/datasource";
import { QueryStatus } from "shared/types/query";
import { CreateProps, UpdateProps } from "shared/types/base-model";
import { ReqContext } from "back-end/types/request";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { getContextFromReq } from "back-end/src/services/organizations";
import {
  createFactTable,
  getAllFactTablesForOrganization,
  getFactTable,
  createColumn,
  updateColumn,
  deleteColumn as deleteColumnInDb,
  updateFactTable,
  updateFactTableColumns,
  deleteFactTable as deleteFactTableInDb,
  deleteFactFilter as deleteFactFilterInDb,
  createFactFilter,
  updateFactFilter,
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
import {
  deriveUserIdTypesFromColumns,
  validateAggregatedFactTableSettings,
  getNextUpdateOccurrence,
} from "back-end/src/util/factTable";
import { logger } from "back-end/src/util/logger";
import { needsColumnRefresh } from "back-end/src/api/fact-tables/updateFactTable";
import {
  AggregatedFactTableStatus,
  buildAggregatedFactTableStatus,
  deriveAggregatedFactTableRunStatus,
  getAggregatedFactTableMetrics,
  runAggregatedFactTableUpdate,
  toAggregatedTableRefreshTriggerResult,
} from "back-end/src/services/aggregatedFactTables";
import { buildAggregatedFactTableSchemaState } from "back-end/src/enterprise/services/data-pipeline";
import { AggregatedFactTableQueryRunner } from "back-end/src/queryRunners/AggregatedFactTableQueryRunner";

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

export const getFactTableById = async (
  req: AuthRequest<unknown, { id: string }>,
  res: Response<{ status: 200; factTable: FactTableInterface }>,
) => {
  const context = getContextFromReq(req);

  const factTable = await getFactTable(context, req.params.id);
  if (!factTable) {
    throw new Error("Could not find fact table with that id");
  }

  res.status(200).json({
    status: 200,
    factTable,
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

  const timestampColumn = "timestamp";

  const sql = integration.getTestQuery({
    // Must have a newline after factTable sql in case it ends with a comment.
    // Expand any virtual column references so the filter runs against real columns.
    query: `SELECT * FROM (
      ${factTable.sql}
    ) f WHERE ${expandVirtualColumnsInSql(filter, factTable)}`,
    templateVariables: {
      eventName: factTable.eventName,
    },
    testDays: context.org.settings?.testQueryDays,
    timestampColumn,
  });

  try {
    const results = await integration.runTestQuery(
      sql,
      [timestampColumn],
      "factTableValidation",
    );
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

async function testVirtualColumnQuery(
  context: ReqContext,
  datasource: DataSourceInterface,
  factTable: FactTableInterface,
  sql: string,
  columnId?: string,
): Promise<FactFilterTestResults> {
  if (!context.permissions.canRunTestQueries(datasource)) {
    context.permissions.throwPermissionError();
  }

  const integration = getSourceIntegrationObject(context, datasource, true);

  if (!integration.getTestQuery || !integration.runTestQuery) {
    throw new Error("Testing not supported on this data source");
  }

  const timestampColumn = "timestamp";

  // Alias the computed expression with the real column id (sanitized to a safe
  // SQL identifier) so the preview matches what the saved column will be named.
  const alias =
    (columnId || "").replace(/[^a-zA-Z0-9_]/g, "") || "__virtual_column";

  // Select the computed expression alongside the raw rows. The expression
  // references bare column names, which resolve against the aliased subquery.
  const testSql = integration.getTestQuery({
    // Must have a newline after factTable sql in case it ends with a comment
    query: `SELECT (${sql}) AS ${alias}, * FROM (
      ${factTable.sql}
    ) f`,
    templateVariables: {
      eventName: factTable.eventName,
    },
    testDays: context.org.settings?.testQueryDays,
    timestampColumn,
  });

  try {
    const results = await integration.runTestQuery(
      testSql,
      [timestampColumn],
      "factTableValidation",
    );
    return {
      sql: testSql,
      ...results,
    };
  } catch (e) {
    return {
      sql: testSql,
      error: e.message,
    };
  }
}

// Helper to merge existing columns with new type map from LIMIT 0
function mergeColumnsWithTypeMap(
  existingColumns: ColumnInterface[],
  typeMap: Map<string, FactTableColumnType>,
): ColumnInterface[] {
  const columns = cloneDeep(existingColumns);

  // Update existing columns
  columns.forEach((col) => {
    // Virtual columns are user-defined and never appear in the SQL output
    // schema, so preserve them instead of marking them deleted.
    if (col.isVirtual) {
      return;
    }
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

  // Flag any virtual columns whose referenced columns were removed.
  revalidateVirtualColumns(columns);

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
  forceColumnRefresh?: boolean,
): Promise<RefreshColumnsResult> {
  if (!context.permissions.canRunFactQueries(datasource)) {
    context.permissions.throwPermissionError();
  }

  const integration = getSourceIntegrationObject(context, datasource, true);

  if (!integration.getTestQuery || !integration.runTestQuery) {
    throw new Error("Testing not supported on this data source");
  }

  // Check if datasource supports LIMIT 0 for fast column metadata
  if (
    !forceColumnRefresh &&
    integration.supportsLimitZeroColumnValidation?.()
  ) {
    const timestampColumn = "timestamp";

    // Fast path: LIMIT 0 query
    const sql = integration.getTestQuery({
      query: factTable.sql,
      templateVariables: { eventName: factTable.eventName },
      testDays: context.org.settings?.testQueryDays,
      limit: 0,
      timestampColumn,
    });

    const result = await integration.runTestQuery(
      sql,
      [timestampColumn],
      "factTableValidation",
    );

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
    const columns = await runRefreshColumnsQuery(
      context,
      datasource,
      factTable,
    );
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
      data as FactTableInterface,
    );

    if (!columns.length) {
      throw new Error("SQL did not return any columns");
    }

    data.columns = columns;
    data.columnRefreshPending = needsBackgroundRefresh;
  }

  if (data.aggregatedFactTableSettings) {
    if (!context.hasPremiumFeature("pipeline-mode")) {
      throw new Error(
        "Maintaining shared daily aggregated tables requires the data pipeline feature.",
      );
    }
    if (!context.permissions.canUpdateDataSourceSettings(datasource)) {
      context.permissions.throwPermissionError();
    }
    validateAggregatedFactTableSettings(
      data.aggregatedFactTableSettings,
      data.userIdTypes,
    );
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
  const forceColumnRefresh = !!req.query?.forceColumnRefresh;

  let columnRefreshResults: Partial<
    Pick<
      FactTableInterface,
      "columns" | "columnsError" | "columnRefreshPending" | "userIdTypes"
    >
  > | null = null;

  if (forceColumnRefresh || needsColumnRefresh(factTable, data)) {
    const { columns, needsBackgroundRefresh } = await refreshColumns(
      context,
      datasource,
      { ...factTable, ...data } as FactTableInterface,
      forceColumnRefresh,
    );

    if (!columns.some((col) => !col.deleted)) {
      throw new Error("SQL did not return any columns");
    }

    columnRefreshResults = {
      columns,
      columnsError: null,
      columnRefreshPending: needsBackgroundRefresh,
    };

    columnRefreshResults.userIdTypes = deriveUserIdTypesFromColumns(
      datasource,
      columns,
    );
  }

  if (data.aggregatedFactTableSettings) {
    if (!context.hasPremiumFeature("pipeline-mode")) {
      throw new Error(
        "Maintaining shared daily aggregated tables requires the data pipeline feature.",
      );
    }
    if (!context.permissions.canUpdateDataSourceSettings(datasource)) {
      context.permissions.throwPermissionError();
    }
    // Validate against the effective userIdTypes after any column refresh.
    const effectiveUserIdTypes =
      columnRefreshResults?.userIdTypes ??
      data.userIdTypes ??
      factTable.userIdTypes;
    validateAggregatedFactTableSettings(
      data.aggregatedFactTableSettings,
      effectiveUserIdTypes,
    );
  }

  await updateFactTable(context, factTable, data);

  if (columnRefreshResults) {
    await updateFactTableColumns(factTable, columnRefreshResults, context);
  }

  if (columnRefreshResults?.columnRefreshPending) {
    await queueFactTableColumnsRefresh({
      id: factTable.id,
      organization: factTable.organization,
    });
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

export const getAggregatedFactTables = async (
  req: AuthRequest<null, { id: string }>,
  res: Response<{
    status: 200;
    aggregatedFactTables: AggregatedFactTableStatus[];
    nextScheduledUpdate: Date | null;
  }>,
) => {
  const context = getContextFromReq(req);

  const factTable = await getFactTable(context, req.params.id);
  if (!factTable) {
    throw new Error("Could not find fact table with that id");
  }

  const idTypes = factTable.aggregatedFactTableSettings?.idTypes ?? [];
  const registryDocs =
    await context.models.aggregatedFactTables.getByFactTableId(factTable.id);
  const byIdType = new Map(registryDocs.map((doc) => [doc.idType, doc]));

  // Build the same schema state the nightly driver would, so the UI can warn
  // when the next run will be forced to restate. Read-only; no warehouse query.
  const factMetrics = await context.models.factMetrics.getAll();
  const metrics = getAggregatedFactTableMetrics({ factMetrics, factTable });
  const { factTableSettingsHash, metricState } =
    buildAggregatedFactTableSchemaState({ factTable, metrics });

  const aggregatedFactTables: AggregatedFactTableStatus[] = idTypes.map(
    (idType) =>
      buildAggregatedFactTableStatus({
        idType,
        doc: byIdType.get(idType),
        factTableSettingsHash,
        metricState,
      }),
  );

  const nextScheduledUpdate = factTable.aggregatedFactTableSettings
    ? getNextUpdateOccurrence(factTable.aggregatedFactTableSettings.updateTime)
    : null;

  res.status(200).json({
    status: 200,
    aggregatedFactTables,
    nextScheduledUpdate,
  });
};

type AggregatedFactTableRunSummary = {
  id: string;
  mode: "incremental" | "restate";
  status: QueryStatus;
  runStarted: Date | null;
  dateCreated: Date;
  finishedAt: Date | null;
  error: string | null;
  queryIds: string[];
};

export const getAggregatedFactTableRuns = async (
  req: AuthRequest<null, { id: string; idType: string }>,
  res: Response<{
    status: 200;
    runs: AggregatedFactTableRunSummary[];
  }>,
) => {
  const context = getContextFromReq(req);

  const factTable = await getFactTable(context, req.params.id);
  if (!factTable) {
    throw new Error("Could not find fact table with that id");
  }

  const { idType } = req.params;
  if (
    !(factTable.aggregatedFactTableSettings?.idTypes ?? []).includes(idType)
  ) {
    throw new Error(
      `id type '${idType}' is not enabled for shared daily aggregated tables on this fact table.`,
    );
  }

  const aggregatedTableRuns =
    await context.models.aggregatedFactTableRuns.getByFactTableAndIdType(
      factTable.id,
      idType,
      { limit: 20, skip: 0 },
    );

  const runs: AggregatedFactTableRunSummary[] = aggregatedTableRuns.runs.map(
    (run) => ({
      id: run.id,
      mode: run.mode,
      status: deriveAggregatedFactTableRunStatus(run.queries, run.error),
      runStarted: run.runStarted,
      dateCreated: run.dateCreated,
      finishedAt: run.finishedAt,
      error: run.error,
      queryIds: run.queries.map((q) => q.query),
    }),
  );

  res.status(200).json({
    status: 200,
    runs,
  });
};

export const refreshAggregatedFactTables = async (
  req: AuthRequest<{ idType?: string; fullRestate?: boolean }, { id: string }>,
  res: Response<{
    status: 200;
    runs: ReturnType<typeof toAggregatedTableRefreshTriggerResult>[];
  }>,
) => {
  const context = getContextFromReq(req);

  const factTable = await getFactTable(context, req.params.id);
  if (!factTable) {
    throw new Error("Could not find fact table with that id");
  }

  if (!context.hasPremiumFeature("pipeline-mode")) {
    throw new Error(
      "Maintaining shared daily aggregated tables requires the data pipeline feature.",
    );
  }

  const datasource = await getDataSourceById(context, factTable.datasource);
  if (!datasource) {
    throw new Error("Could not find datasource for this fact table");
  }

  if (!context.permissions.canUpdateDataSourceSettings(datasource)) {
    context.permissions.throwPermissionError();
  }

  const enabledIdTypes = factTable.aggregatedFactTableSettings?.idTypes ?? [];
  if (!enabledIdTypes.length) {
    throw new Error(
      "This fact table does not have any id types enabled for shared daily aggregated tables.",
    );
  }

  let idTypes = enabledIdTypes;
  if (req.body.idType) {
    if (!enabledIdTypes.includes(req.body.idType)) {
      throw new Error(
        `id type '${req.body.idType}' is not enabled for shared daily aggregated tables on this fact table.`,
      );
    }
    idTypes = [req.body.idType];
  }

  // Kick off directly (not via the nightly agenda queue); each call returns
  // once the run doc + queries exist and finishes in the background.
  const runs = [];
  for (const idType of idTypes) {
    const outcome = await runAggregatedFactTableUpdate(
      context,
      factTable,
      idType,
      {
        forceRestate: !!req.body.fullRestate,
        awaitResults: false,
      },
    );
    runs.push(toAggregatedTableRefreshTriggerResult(idType, outcome));
  }

  res.status(200).json({
    status: 200,
    runs,
  });
};

export const cancelAggregatedFactTableRun = async (
  req: AuthRequest<null, { id: string; idType: string }>,
  res: Response<{ status: 200 }>,
) => {
  const context = getContextFromReq(req);

  const factTable = await getFactTable(context, req.params.id);
  if (!factTable) {
    throw new Error("Could not find fact table with that id");
  }
  const factTableDatasource = await getDataSourceById(
    context,
    factTable.datasource,
  );
  if (!factTableDatasource) {
    throw new Error("Could not find datasource for this fact table");
  }

  if (!context.permissions.canUpdateDataSourceSettings(factTableDatasource)) {
    context.permissions.throwPermissionError();
  }

  const { idType } = req.params;
  if (
    !(factTable.aggregatedFactTableSettings?.idTypes ?? []).includes(idType)
  ) {
    throw new Error(
      `id type '${idType}' is not enabled for shared daily aggregated tables on this fact table.`,
    );
  }

  const aggregatedTableRuns =
    await context.models.aggregatedFactTableRuns.getByFactTableAndIdType(
      factTable.id,
      idType,
      { limit: 20, skip: 0 },
    );

  const run = aggregatedTableRuns.runs.find(
    (r) => deriveAggregatedFactTableRunStatus(r.queries, r.error) === "running",
  );
  if (!run) {
    res.status(200).json({ status: 200 });
    return;
  }

  const datasource = await getDataSourceById(context, run.datasourceId);
  if (!datasource) {
    throw new Error("Could not find datasource for this run");
  }

  const integration = getSourceIntegrationObject(context, datasource, true);

  const queryRunner = new AggregatedFactTableQueryRunner(
    context,
    run,
    integration,
    false,
  );
  await queryRunner.cancelQueries();

  // cancelQueries blanks the error/queries (read as "queued"); restore them and
  // record a terminal error so the run shows as failed with viewable queries.
  await context.models.aggregatedFactTableRuns.updateRunFields(run.id, {
    error: "Run cancelled by user",
    finishedAt: new Date(),
    queries: run.queries,
  });

  // cancelQueries can't release the registry lock without the run's executionId.
  const key = {
    datasourceId: run.datasourceId,
    factTableId: run.factTableId,
    idType: run.idType,
  };
  await context.models.aggregatedFactTables.updateByKeyIfCurrentExecution(
    key,
    run.executionId,
    { lastError: "Run cancelled by user", lastRunId: run.id },
  );
  await context.models.aggregatedFactTables.releaseLock(key, run.executionId);

  res.status(200).json({ status: 200 });
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
    (canInlineFilterColumn(factTable, column.column) &&
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
      logger.error(
        e,
        `Error running top values query for specific column on ${datasource.type}`,
        {
          column: req.params.column,
        },
      );
      throw e;
    }
  } else {
    throw new Error(
      "Column does not meet requirements for top values refresh (must be a string column and not a user-id type)",
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

  // Editing a virtual column's expression must not blank it out. (dependsOn is
  // recomputed server-side inside updateColumn.)
  if (col.isVirtual && data.sql !== undefined && !data.sql.trim()) {
    throw new Error("Virtual columns require a SQL expression");
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
          logger.warn(
            `Failed to get top values for column on ${datasource.type}`,
            e,
          );
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

export const postColumn = async (
  req: AuthRequest<CreateColumnProps, { id: string }>,
  res: Response<{ status: 200; column: ColumnInterface }>,
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

  // This endpoint only creates virtual columns. SQL-detected columns are
  // created by column auto-detection, not directly.
  if (!data.isVirtual) {
    throw new Error("Only virtual columns can be created directly");
  }
  if (!data.sql || !data.sql.trim()) {
    throw new Error("Virtual columns require a SQL expression");
  }
  if (!data.column.match(/^[a-zA-Z0-9_]+_vc$/)) {
    throw new Error(
      "Virtual column ids must contain only letters, numbers, and underscores and end with '_vc'",
    );
  }
  if (!data.datatype) {
    throw new Error("Virtual columns require a data type");
  }

  // dependsOn is computed server-side inside createColumn.
  const column = await createColumn(factTable, data);

  res.status(200).json({
    status: 200,
    column,
  });
};

export const deleteColumn = async (
  req: AuthRequest<null, { id: string; column: string }>,
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

  await deleteColumnInDb(context, factTable, req.params.column);

  res.status(200).json({
    status: 200,
  });
};

export const postVirtualColumnTest = async (
  req: AuthRequest<TestVirtualColumnProps, { id: string }>,
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

  if (!context.permissions.canUpdateFactTable(factTable, { columns: [] })) {
    context.permissions.throwPermissionError();
  }

  const datasource = await getDataSourceById(context, factTable.datasource);
  if (!datasource) {
    throw new Error("Could not find datasource");
  }

  const result = await testVirtualColumnQuery(
    context,
    datasource,
    factTable,
    data.sql,
    data.columnId,
  );

  res.status(200).json({
    status: 200,
    result,
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
  req: AuthRequest<UpdateProps<FactMetricInterface>, { id: string }>,
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
