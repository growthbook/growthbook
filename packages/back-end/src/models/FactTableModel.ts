import mongoose, { FilterQuery } from "mongoose";
import uniqid from "uniqid";
import { omit } from "lodash";
import { sqlReferencesColumn } from "shared/experiments";
import { explorationConfigReferencesColumn } from "shared/enterprise";
import { SqlIdentifierQuote } from "shared/types/sql";
import {
  CreateColumnProps,
  CreateFactFilterProps,
  CreateFactTableProps,
  ColumnRef,
  FactFilterInterface,
  FactTableDefinition,
  FactTableInterface,
  UpdateFactFilterProps,
  UpdateColumnProps,
  UpdateFactTableProps,
  ColumnInterface,
} from "shared/types/fact-table";
import {
  ApiFactTable,
  ApiFactTableColumn,
  ApiFactTableFilter,
} from "shared/validators";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";
import { promiseAllChunks } from "back-end/src/util/promise";
import { projectFilterQuery } from "back-end/src/util/mongo.util";
import { createModelAuditLogger } from "back-end/src/services/audit";
import { deferAggregatedFactTableToNextSlot } from "back-end/src/services/aggregatedFactTables";
import {
  ensureAutoSliceDefaults,
  normalizeJSONFieldsInput,
  normalizePersistedColumn,
} from "back-end/src/util/factTable";

const audit = createModelAuditLogger({
  entity: "factTable",
  createEvent: "factTable.create",
  updateEvent: "factTable.update",
  deleteEvent: "factTable.delete",
  autocreateEvent: "factTable.autocreate",
});

const factTableSchema = new mongoose.Schema({
  id: String,
  managedBy: String,
  organization: String,
  dateCreated: Date,
  dateUpdated: Date,
  name: String,
  description: String,
  owner: String,
  projects: [String],
  tags: [String],
  datasource: String,
  userIdTypes: [String],
  sql: String,
  eventName: String,
  columns: [
    {
      _id: false,
      name: String,
      dateCreated: Date,
      dateUpdated: Date,
      description: String,
      column: String,
      numberFormat: String,
      datatype: String,
      jsonFields: {},
      deleted: Boolean,
      alwaysInlineFilter: Boolean,
      topValues: [String],
      topValuesDate: Date,
      isAutoSliceColumn: Boolean,
      autoSlices: [String],
      lockedAutoSlices: [String],
      isVirtual: Boolean,
      sql: String,
    },
  ],
  columnsError: String,
  filters: [
    {
      _id: false,
      id: String,
      name: String,
      dateCreated: Date,
      dateUpdated: Date,
      description: String,
      value: String,
      managedBy: String,
    },
  ],
  archived: Boolean,
  autoSliceUpdatesEnabled: Boolean,
  aggregatedFactTableSettings: {
    _id: false,
    type: {
      idTypes: [String],
      updateTime: {
        _id: false,
        type: {
          time: String,
          timezone: String,
        },
      },
      lookbackWindow: Number,
      restateChunkDays: Number,
    },
    default: undefined,
  },
  columnRefreshPending: Boolean,
});

factTableSchema.index({ id: 1, organization: 1 }, { unique: true });
// Compound indexes for API list filtering
factTableSchema.index({ organization: 1, datasource: 1 });

type FactTableDocument = mongoose.Document & FactTableInterface;

const FactTableModel = mongoose.model<FactTableInterface>(
  "FactTable",
  factTableSchema,
);

function toInterface(doc: FactTableDocument): FactTableInterface {
  const ret = doc.toJSON<FactTableDocument>();
  return omit(ret, ["__v", "_id"]);
}

export function buildColumnInterface(
  column: CreateColumnProps,
): ColumnInterface {
  const columnInterface: ColumnInterface = {
    ...column,
    name: column.name ?? column.column,
    description: column.description ?? "",
    numberFormat: column.numberFormat ?? "",
    datatype: column.datatype ?? "",
    jsonFields: normalizeJSONFieldsInput(column.jsonFields),
    dateCreated: new Date(),
    dateUpdated: new Date(),
    deleted: false,
  };

  return normalizePersistedColumn(columnInterface);
}

function createPropsToInterface(
  context: ReqContext | ApiReqContext,
  rawProps: CreateFactTableProps,
): FactTableInterface {
  const props = {
    ...rawProps,
    owner: rawProps.owner || context.userId,
  };
  const id = props.id || uniqid("ftb_");
  if (!id.match(/^[-a-zA-Z0-9_]+$/)) {
    throw new Error(
      "Fact table ids must contain only letters, numbers, underscores, and dashes",
    );
  }

  const columns: ColumnInterface[] = props.columns
    ? props.columns.map(buildColumnInterface)
    : [];

  return {
    organization: context.org.id,
    id,
    name: props.name,
    description: props.description,
    dateCreated: new Date(),
    dateUpdated: new Date(),
    datasource: props.datasource,
    filters: [],
    owner: props.owner,
    projects: props.projects,
    tags: props.tags,
    sql: props.sql,
    userIdTypes: props.userIdTypes,
    eventName: props.eventName,
    columns,
    columnsError: null,
    managedBy: props.managedBy || "",
    aggregatedFactTableSettings: props.aggregatedFactTableSettings ?? null,
    columnRefreshPending: props.columnRefreshPending || false,
  };
}

export async function getAllFactTablesForOrganization(
  context: ReqContext | ApiReqContext,
  options?: {
    datasourceId?: string;
    projectId?: string;
  },
) {
  const query: FilterQuery<FactTableInterface> = {
    organization: context.org.id,
    ...(options?.datasourceId && { datasource: options.datasourceId }),
    ...(options?.projectId && projectFilterQuery(options.projectId)),
  };

  const docs = await FactTableModel.find(query).sort({ id: 1 });
  return docs
    .map((doc) => toInterface(doc))
    .filter((f) => context.permissions.canReadMultiProjectResource(f.projects));
}

// Slimmed version of getAllFactTablesForOrganization for the definitions
// endpoint. The sql field and per-column jsonFields maps are excluded at the DB
// layer to keep the payload small; consumers fetch the full fact table by id
// when they need them.
export async function getAllFactTablesForDefinitions(
  context: ReqContext | ApiReqContext,
): Promise<FactTableDefinition[]> {
  const docs = await FactTableModel.find(
    { organization: context.org.id },
    { sql: 0, "columns.jsonFields": 0 },
  ).sort({ id: 1 });
  return docs
    .map((doc) => toInterface(doc))
    .filter((f) => context.permissions.canReadMultiProjectResource(f.projects));
}

export async function getFactTablesForDatasource(
  context: ReqContext,
  datasource: string,
): Promise<FactTableInterface[]> {
  const docs = await FactTableModel.find({
    organization: context.org.id,
    datasource,
  });

  return docs
    .map((doc) => toInterface(doc))
    .filter((f) => context.permissions.canReadMultiProjectResource(f.projects));
}

export type FactTableMap = Map<string, FactTableInterface>;

export async function getFactTableMap(
  context: ReqContext | ApiReqContext,
): Promise<FactTableMap> {
  const factTables = await getAllFactTablesForOrganization(context);

  return new Map(factTables.map((f) => [f.id, f]));
}

// WARNING: bypasses project-read permission. Use only for system-driven
// managed-warehouse sync (see dangerouslyGetGrowthbookDatasourceBypassPermission).
export async function dangerouslyGetFactTableByIdBypassPermission(
  organization: string,
  id: string,
): Promise<FactTableInterface | null> {
  const doc = await FactTableModel.findOne({ organization, id });
  return doc ? toInterface(doc) : null;
}

export async function getFactTable(
  context: ReqContext | ApiReqContext,
  id: string,
) {
  const doc = await FactTableModel.findOne({
    organization: context.org.id,
    id,
  });
  if (!doc) return null;

  const factTable = toInterface(doc);
  if (!context.permissions.canReadMultiProjectResource(factTable.projects)) {
    return null;
  }
  return factTable;
}

export async function getFactTablesByIds(
  context: ReqContext | ApiReqContext,
  ids: string[],
) {
  const factTables: FactTableInterface[] = [];

  if (!ids.length) {
    return factTables;
  }

  const docs = await FactTableModel.find({
    id: { $in: ids },
    organization: context.org.id,
  });
  docs.forEach((doc) => {
    factTables.push(toInterface(doc));
  });

  return factTables.filter((factTable) =>
    context.permissions.canReadMultiProjectResource(factTable.projects),
  );
}

// Get all fact tables with auto-slice updates enabled across all organizations.
// Used by scheduled jobs that need to query across organizations.
export async function getAllFactTablesWithAutoSliceUpdatesEnabled(): Promise<
  FactTableInterface[]
> {
  const docs = await FactTableModel.find({
    autoSliceUpdatesEnabled: true,
    archived: { $ne: true },
  });
  return docs.map((doc) => toInterface(doc));
}

// Across all organizations; used by the nightly aggregated fact table job.
export async function getAllFactTablesWithAggregatedTablesEnabled(): Promise<
  FactTableInterface[]
> {
  const docs = await FactTableModel.find({
    "aggregatedFactTableSettings.idTypes": { $exists: true, $ne: [] },
    archived: { $ne: true },
  });
  return docs.map((doc) => toInterface(doc));
}

export async function createFactTable(
  context: ReqContext | ApiReqContext,
  data: CreateFactTableProps,
) {
  if (
    data.managedBy === "admin" &&
    !context.hasPremiumFeature("manage-official-resources")
  ) {
    throw new Error(
      "Your organization's plan does not support creating official fact tables.",
    );
  }

  if (!context.permissions.canCreateFactTable(data)) {
    context.permissions.throwPermissionError();
  }

  const factTableProps = createPropsToInterface(context, data);

  // We claim this slot first to avoid a potential race condition when the FactTable is created at
  // the same time the background job is scheduling the aggregated table update
  await deferAggregatedFactTableToNextSlot(context, factTableProps);

  const doc = await FactTableModel.create(factTableProps);

  const factTable = toInterface(doc);

  await audit.logCreate(context, factTable);

  return factTable;
}

export async function updateFactTable(
  context: ReqContext | ApiReqContext,
  factTable: FactTableInterface,
  changes: UpdateFactTableProps,
) {
  // Allow changing columns even for API-managed fact tables. Also allow
  // system/background contexts (which have no audit user) through, e.g. the
  // event forwarder sync.
  if (
    factTable.managedBy === "api" &&
    context.auditUser?.type !== "api_key" &&
    context.auditUser !== null &&
    Object.keys(changes).some((k) => k !== "columns")
  ) {
    throw new Error(
      "Cannot update fact table managed by API if the request isn't from the API.",
    );
  }

  if (!context.permissions.canUpdateFactTable(factTable, changes)) {
    context.permissions.throwPermissionError();
  }

  // Clean up auto slices from metrics if columns were deleted or modified
  if (changes.columns) {
    const removedColumns = detectRemovedColumns(
      factTable.columns || [],
      changes.columns,
    );

    if (removedColumns.length > 0) {
      await cleanupMetricAutoSlices({
        context,
        factTableId: factTable.id,
        removedColumns,
      });
    }
  }

  await FactTableModel.updateOne(
    {
      id: factTable.id,
      organization: factTable.organization,
    },
    {
      $set: {
        ...changes,
        dateUpdated: new Date(),
      },
    },
  );

  await audit.logUpdate(context, factTable, { ...factTable, ...changes });
}

const ALLOWED_COLUMN_UPDATE_FIELDS = [
  "columns",
  "columnsError",
  "columnRefreshPending",
  "userIdTypes",
] as const;

// This is called from a background cronjob to re-sync all of the columns
// It doesn't need to check for 'managedBy' and doesn't need to set 'dateUpdated'
export async function updateFactTableColumns(
  factTable: FactTableInterface,
  changes: Partial<
    Pick<FactTableInterface, (typeof ALLOWED_COLUMN_UPDATE_FIELDS)[number]>
  >,
  context: ReqContext | ApiReqContext,
) {
  const safeChanges = Object.fromEntries(
    Object.entries(changes).filter(([key]) =>
      ALLOWED_COLUMN_UPDATE_FIELDS.includes(
        key as (typeof ALLOWED_COLUMN_UPDATE_FIELDS)[number],
      ),
    ),
  );

  await FactTableModel.updateOne(
    {
      id: factTable.id,
      organization: factTable.organization,
    },
    {
      $set: safeChanges,
    },
  );

  // Clean up auto slices from metrics if columns were refreshed and some were deleted
  if (changes.columns) {
    const removedColumns = detectRemovedColumns(
      factTable.columns || [],
      changes.columns,
    );

    if (removedColumns.length > 0) {
      await cleanupMetricAutoSlices({
        context,
        factTableId: factTable.id,
        removedColumns,
      });
    }
  }
}

// System-driven update of the managed-warehouse events fact table (managedBy "api").
// Unlike updateFactTable, this is allowed from internal (non-API) requests because
// GrowthBook itself owns this table's sql/columns/userIdTypes. Used when the org's
// identifiers (hashAttribute attributes) change.
export async function dangerouslySyncManagedWarehouseFactTable(
  context: ReqContext | ApiReqContext,
  factTable: FactTableInterface,
  changes: Pick<UpdateFactTableProps, "sql" | "columns" | "userIdTypes">,
) {
  if (changes.columns) {
    const removedColumns = detectRemovedColumns(
      factTable.columns || [],
      changes.columns,
    );
    if (removedColumns.length > 0) {
      await cleanupMetricAutoSlices({
        context,
        factTableId: factTable.id,
        removedColumns,
      });
    }
  }

  await FactTableModel.updateOne(
    {
      id: factTable.id,
      organization: factTable.organization,
    },
    {
      $set: {
        ...changes,
        dateUpdated: new Date(),
      },
    },
  );
}

// Detect columns that were removed or had auto slice disabled
export function detectRemovedColumns(
  originalColumns: Array<{
    column: string;
    deleted?: boolean;
    isAutoSliceColumn?: boolean;
  }>,
  newColumns: Array<{
    column: string;
    deleted?: boolean;
    isAutoSliceColumn?: boolean;
  }>,
): string[] {
  // Find columns that were deleted (existed before but don't exist now)
  const deletedColumns = originalColumns
    .filter((col) => !col.deleted)
    .map((col) => col.column)
    .filter(
      (columnName) =>
        !newColumns.some(
          (newCol) => newCol.column === columnName && !newCol.deleted,
        ),
    );

  // Find columns where isAutoSliceColumn was disabled
  const disabledAutoSliceColumns = originalColumns
    .filter((col) => col.isAutoSliceColumn && !col.deleted)
    .map((col) => col.column)
    .filter((columnName) => {
      const newCol = newColumns.find((newCol) => newCol.column === columnName);
      return newCol && !newCol.isAutoSliceColumn;
    });

  return [...deletedColumns, ...disabledAutoSliceColumns];
}

// Clean up auto slices from fact metrics when columns are "deleted" or dropped
export async function cleanupMetricAutoSlices({
  context,
  factTableId,
  removedColumns,
}: {
  context: ReqContext | ApiReqContext;
  factTableId: string;
  removedColumns: string[];
}) {
  // Get all fact metrics that use this fact table
  const allFactMetrics = await context.models.factMetrics.getAll();
  const affectedMetrics = allFactMetrics.filter(
    (metric) => metric.numerator?.factTableId === factTableId,
  );

  // For each affected metric, remove auto slices that reference removed columns
  for (const metric of affectedMetrics) {
    if (!metric.metricAutoSlices?.length) continue;

    const originalAutoSlices = [...metric.metricAutoSlices];
    const cleanedAutoSlices = metric.metricAutoSlices.filter(
      (sliceColumn) => !removedColumns.includes(sliceColumn),
    );

    // Only update if there were changes
    if (cleanedAutoSlices.length !== originalAutoSlices.length) {
      await context.models.factMetrics.update(metric, {
        metricAutoSlices: cleanedAutoSlices,
      });
    }
  }
}

export async function updateColumn({
  context,
  factTable,
  column,
  changes,
}: {
  context?: ReqContext | ApiReqContext;
  factTable: FactTableInterface;
  column: string;
  changes: UpdateColumnProps;
}) {
  const columnIndex = factTable.columns.findIndex((c) => c.column === column);
  if (columnIndex < 0) throw new Error("Could not find that column");

  if (
    changes.alwaysInlineFilter &&
    (changes.datatype || factTable.columns[columnIndex]?.datatype) !== "string"
  ) {
    throw new Error("Only string columns are eligible for inline filtering");
  }

  const originalColumn = factTable.columns[columnIndex];
  const updatedColumn = ensureAutoSliceDefaults({
    ...originalColumn,
    ...changes,
    jsonFields:
      changes.jsonFields !== undefined
        ? normalizeJSONFieldsInput(changes.jsonFields)
        : originalColumn.jsonFields,
    ...(changes.topValues ? { topValuesDate: new Date() } : {}),
    dateUpdated: new Date(),
  });

  factTable.columns[columnIndex] = updatedColumn;

  await FactTableModel.updateOne(
    {
      id: factTable.id,
      organization: factTable.organization,
    },
    {
      $set: {
        dateUpdated: new Date(),
        columns: factTable.columns,
      },
    },
  );

  // Clean up auto slices from metrics if column was deleted or isAutoSliceColumn was disabled
  if (
    context &&
    (updatedColumn.deleted ||
      (!updatedColumn.isAutoSliceColumn && originalColumn.isAutoSliceColumn))
  ) {
    await cleanupMetricAutoSlices({
      context,
      factTableId: factTable.id,
      removedColumns: [column],
    });
  }
}

export async function createColumn(
  factTable: FactTableInterface,
  data: CreateColumnProps,
): Promise<ColumnInterface> {
  // Collide against ALL existing column identifiers, including soft-deleted
  // source columns. `column` is the stable identifier inlined into generated
  // SQL and metric references, so reusing a soft-deleted source column's id
  // would resolve inconsistently if that source column later reappears on a
  // refresh. Comparison is case-insensitive.
  const newId = data.column.toLowerCase();
  if (factTable.columns.some((c) => c.column.toLowerCase() === newId)) {
    throw new Error(
      `A column with the id "${data.column}" already exists in this fact table`,
    );
  }

  // Build/normalize the column the same way every other write path does
  // (defaults, jsonFields normalization, datatype "" = auto-detect pending).
  const column = buildColumnInterface(data);

  const columns = [...factTable.columns, column];

  await FactTableModel.updateOne(
    {
      id: factTable.id,
      organization: factTable.organization,
    },
    {
      $set: {
        dateUpdated: new Date(),
        columns,
      },
    },
  );

  return column;
}

// Whether a ColumnRef (numerator/denominator) still uses `columnName` on this
// fact table — structured fields or free SQL in row filters / saved filters.
function columnRefReferencesColumn(
  ref: ColumnRef,
  columnName: string,
  factTable: FactTableInterface,
  identifierQuote: SqlIdentifierQuote,
): boolean {
  if (ref.factTableId !== factTable.id) return false;
  if (ref.column === columnName) return true;
  if (ref.aggregateFilterColumn === columnName) return true;

  for (const rowFilter of ref.rowFilters || []) {
    if (rowFilter.column === columnName) return true;
    if (
      rowFilter.operator === "sql_expr" &&
      rowFilter.values?.[0] &&
      sqlReferencesColumn(rowFilter.values[0], columnName, identifierQuote)
    ) {
      return true;
    }
    if (rowFilter.operator === "saved_filter" && rowFilter.values?.[0]) {
      const filter = factTable.filters.find(
        (f) => f.id === rowFilter.values?.[0],
      );
      if (
        filter &&
        sqlReferencesColumn(filter.value, columnName, identifierQuote)
      ) {
        return true;
      }
    }
  }
  return false;
}

// Saved explorations and dashboard blocks that still reference `columnName` on
// this fact table. Scanned on demand so no dependency state is persisted.
// `getAll()` applies each model's read filter, so a scan can under-report for a
// caller who lacks read access to some datasources — acceptable for a
// best-effort delete guard.
async function getDependentExplorationsAndDashboards(
  context: ReqContext | ApiReqContext,
  factTable: FactTableInterface,
  columnName: string,
  identifierQuote: SqlIdentifierQuote,
): Promise<{
  explorations: Array<{ id: string; name?: string }>;
  dashboards: Array<{ id: string; name?: string }>;
}> {
  const [allExplorations, allDashboards] = await Promise.all([
    context.models.analyticsExplorations.getAll(),
    context.models.dashboards.getAll(),
  ]);

  const explorations = allExplorations
    .filter((e) =>
      explorationConfigReferencesColumn(
        e.config,
        factTable.id,
        columnName,
        identifierQuote,
        factTable.filters,
      ),
    )
    .map((e) => ({ id: e.id }));

  const dashboards = allDashboards
    .filter((d) =>
      d.blocks.some(
        (block) =>
          "config" in block &&
          explorationConfigReferencesColumn(
            block.config,
            factTable.id,
            columnName,
            identifierQuote,
            factTable.filters,
          ),
      ),
    )
    .map((d) => ({ id: d.id, name: d.title }));

  return { explorations, dashboards };
}

export async function deleteColumn(
  context: ReqContext | ApiReqContext,
  factTable: FactTableInterface,
  columnName: string,
  identifierQuote: SqlIdentifierQuote = '"',
): Promise<void> {
  const col = factTable.columns.find((c) => c.column === columnName);
  if (!col) {
    throw new Error("Could not find that column");
  }
  // Only virtual columns can be hard-deleted. SQL-detected columns are managed
  // by the column refresh (soft delete) and must not be removed here.
  if (!col.isVirtual) {
    throw new Error("Only virtual columns can be deleted");
  }

  // Block deletion if anything still references this column — otherwise
  // generated SQL falls back to a bare, now-undefined identifier and fails
  // at query time. Scanned on demand (other virtual columns, saved filters,
  // Fact Metrics, saved explorations, and dashboard blocks); no dependency
  // state is persisted.
  const dependentVirtualColumns = factTable.columns.filter(
    (c) =>
      c.isVirtual &&
      !c.deleted &&
      c.column !== columnName &&
      c.sql &&
      sqlReferencesColumn(c.sql, columnName, identifierQuote),
  );
  const dependentFilters = factTable.filters.filter((f) =>
    sqlReferencesColumn(f.value, columnName, identifierQuote),
  );
  const allFactMetrics = await context.models.factMetrics.getAll();
  const dependentMetrics = allFactMetrics.filter(
    (metric) =>
      columnRefReferencesColumn(
        metric.numerator,
        columnName,
        factTable,
        identifierQuote,
      ) ||
      (metric.denominator !== null &&
        columnRefReferencesColumn(
          metric.denominator,
          columnName,
          factTable,
          identifierQuote,
        )),
  );

  // Explorations and dashboard blocks persist column references (valueColumn,
  // dimensions, row filters) that resolve through the same query-time
  // chokepoint, so a virtual column they use must not be deleted out from
  // under them.
  const {
    explorations: dependentExplorations,
    dashboards: dependentDashboards,
  } = await getDependentExplorationsAndDashboards(
    context,
    factTable,
    columnName,
    identifierQuote,
  );

  const lines: string[] = [
    ...dependentVirtualColumns.map(
      (c) => `\n - Virtual column: ${c.name || c.column}`,
    ),
    ...dependentFilters.map((f) => `\n - Filter: ${f.name || f.id}`),
    ...dependentMetrics.map((m) => `\n - Fact Metric: ${m.name || m.id}`),
    ...dependentExplorations.map((e) => `\n - Exploration: ${e.name || e.id}`),
    ...dependentDashboards.map((d) => `\n - Dashboard: ${d.name || d.id}`),
  ];
  if (lines.length) {
    throw new Error(
      `Cannot delete: the following still reference it:${lines.join("")}`,
    );
  }

  const columns = factTable.columns.filter((c) => c.column !== columnName);

  await FactTableModel.updateOne(
    {
      id: factTable.id,
      organization: factTable.organization,
    },
    {
      $set: {
        dateUpdated: new Date(),
        columns,
      },
    },
  );

  // A virtual column may be referenced by metric auto-slices; remove those.
  await cleanupMetricAutoSlices({
    context,
    factTableId: factTable.id,
    removedColumns: [columnName],
  });
}

export function mergeUpsertColumns(
  existing: ColumnInterface[],
  incoming: Array<UpdateColumnProps & { column: string }>,
): { columns: ColumnInterface[]; removedAutoSliceColumns: string[] } {
  const columns: ColumnInterface[] = existing.map((c) => ({ ...c }));
  const removedAutoSliceColumns: string[] = [];

  for (const incomingColumn of incoming) {
    const index = columns.findIndex((c) => c.column === incomingColumn.column);

    if (index < 0) {
      columns.push(buildColumnInterface(incomingColumn));
      continue;
    }

    const originalColumn = columns[index];
    const nextColumn = normalizePersistedColumn({
      ...originalColumn,
      ...omit(incomingColumn, [
        "column",
        "datatype",
        "jsonFields",
        "dateCreated",
        "dateUpdated",
        // Origin is immutable on upsert (handled explicitly below).
        "isVirtual",
        "sql",
      ]),
      datatype: incomingColumn.datatype ?? originalColumn.datatype,
      jsonFields:
        incomingColumn.jsonFields !== undefined
          ? normalizeJSONFieldsInput(incomingColumn.jsonFields)
          : originalColumn.jsonFields,
      // A column's origin cannot be flipped through an upsert: a SQL-detected
      // column can never become virtual, and a virtual column can never lose
      // its definition. For a virtual column, an incoming `sql` updates the
      // expression; when omitted, the existing expression is preserved (so a
      // partial sync that doesn't repeat `sql` never blanks it out).
      isVirtual: originalColumn.isVirtual,
      sql: originalColumn.isVirtual
        ? (incomingColumn.sql ?? originalColumn.sql)
        : undefined,
      ...(incomingColumn.topValues ? { topValuesDate: new Date() } : {}),
      dateUpdated: new Date(),
    });

    columns[index] = nextColumn;
    if (
      nextColumn.deleted ||
      (!nextColumn.isAutoSliceColumn && originalColumn.isAutoSliceColumn)
    ) {
      removedAutoSliceColumns.push(incomingColumn.column);
    }
  }

  return { columns, removedAutoSliceColumns };
}

export async function upsertColumns({
  context,
  factTable,
  columns,
}: {
  context?: ReqContext | ApiReqContext;
  factTable: FactTableInterface;
  columns: Array<UpdateColumnProps & { column: string }>;
}): Promise<void> {
  const { columns: nextColumns, removedAutoSliceColumns } = mergeUpsertColumns(
    factTable.columns,
    columns,
  );

  factTable.columns = nextColumns;

  await FactTableModel.updateOne(
    {
      id: factTable.id,
      organization: factTable.organization,
    },
    {
      $set: {
        dateUpdated: new Date(),
        columns: nextColumns,
      },
    },
  );

  if (context && removedAutoSliceColumns.length > 0) {
    await cleanupMetricAutoSlices({
      context,
      factTableId: factTable.id,
      removedColumns: removedAutoSliceColumns,
    });
  }
}

export async function createFactFilter(
  factTable: FactTableInterface,
  data: CreateFactFilterProps,
) {
  if (!factTable.managedBy && data.managedBy) {
    throw new Error(
      "Cannot create a filter managed by API unless the Fact Table is also managed by API",
    );
  }

  const id = data.id || uniqid("flt_");
  if (!id.match(/^[-a-zA-Z0-9_]+$/)) {
    throw new Error(
      "Fact table filter ids must contain only letters, numbers, underscores, and dashes",
    );
  }

  const filter: FactFilterInterface = {
    id,
    name: data.name,
    dateCreated: new Date(),
    dateUpdated: new Date(),
    value: data.value,
    description: data.description,
    managedBy: data.managedBy || "",
  };

  if (factTable.filters.some((f) => f.id === filter.id)) {
    throw new Error("Filter id already exists in this fact table");
  }

  await FactTableModel.updateOne(
    {
      id: factTable.id,
      organization: factTable.organization,
    },
    {
      $set: {
        dateUpdated: new Date(),
      },
      $push: {
        filters: filter,
      },
    },
  );

  return filter;
}

export async function updateFactFilter(
  context: ReqContext | ApiReqContext,
  factTable: FactTableInterface,
  filterId: string,
  changes: UpdateFactFilterProps,
) {
  const filters = [...factTable.filters];

  const filterIndex = filters.findIndex((f) => f.id === filterId);
  if (filterIndex < 0) throw new Error("Could not find filter with that id");

  if (
    factTable.managedBy === "api" &&
    filters[filterIndex]?.managedBy === "api" &&
    context.auditUser?.type !== "api_key"
  ) {
    throw new Error("This fact filter is managed by the API");
  }

  filters[filterIndex] = {
    ...filters[filterIndex],
    ...changes,
    dateUpdated: new Date(),
  };

  await FactTableModel.updateOne(
    {
      id: factTable.id,
      organization: factTable.organization,
    },
    {
      $set: {
        dateUpdated: new Date(),
        filters: filters,
      },
    },
  );
}

export async function deleteFactTable(
  context: ReqContext | ApiReqContext,
  factTable: FactTableInterface,
  {
    bypassManagedByCheck,
  }: {
    bypassManagedByCheck?: boolean;
  } = {},
) {
  if (
    !bypassManagedByCheck &&
    factTable.managedBy === "api" &&
    context.auditUser?.type !== "api_key"
  ) {
    throw new Error(
      "Cannot delete fact table managed by API if the request isn't from the API.",
    );
  }

  if (!context.permissions.canDeleteFactTable(factTable)) {
    context.permissions.throwPermissionError();
  }

  await FactTableModel.deleteOne({
    id: factTable.id,
    organization: factTable.organization,
  });

  await audit.logDelete(context, factTable);
}

export async function projectHasFactTables(
  context: ReqContext | ApiReqContext,
  projectId: string,
): Promise<boolean> {
  return !!(await FactTableModel.exists({
    organization: context.org.id,
    projects: [projectId],
  }));
}

export async function deleteAllFactTablesForAProject({
  projectId,
  context,
}: {
  projectId: string;
  context: ReqContext | ApiReqContext;
}) {
  const factTablesToDelete = await FactTableModel.find({
    organization: context.org.id,
    projects: [projectId],
  });

  await promiseAllChunks(
    factTablesToDelete.map(
      (factTable) => async () => await deleteFactTable(context, factTable),
    ),
    5,
  );
}

export async function deleteFactFilter(
  context: ReqContext | ApiReqContext,
  factTable: FactTableInterface,
  filterId: string,
) {
  const filter = factTable.filters.find((f) => f.id === filterId);

  if (
    factTable.managedBy === "api" &&
    filter?.managedBy === "api" &&
    context.auditUser?.type !== "api_key"
  ) {
    throw new Error("This filter is managed by the API");
  }

  const newFilters = factTable.filters.filter((f) => f.id !== filterId);

  if (newFilters.length === factTable.filters.length) {
    throw new Error("Could not find filter with that id");
  }

  await FactTableModel.updateOne(
    {
      id: factTable.id,
      organization: factTable.organization,
    },
    {
      $set: {
        dateUpdated: new Date(),
        filters: newFilters,
      },
    },
  );
}

export function toFactTableApiInterface(
  factTable: FactTableInterface,
): ApiFactTable {
  return {
    ...omit(factTable, [
      "organization",
      "filters",
      "dateCreated",
      "dateUpdated",
    ]),
    columns: factTable.columns.map((col) => ({
      ...col,
      alwaysInlineFilter: col.alwaysInlineFilter ?? false,
      isAutoSliceColumn: col.isAutoSliceColumn ?? false,
      dateCreated: col.dateCreated.toISOString(),
      dateUpdated: col.dateUpdated.toISOString(),
      topValuesDate: col.topValuesDate?.toISOString(),
    })),
    managedBy: factTable.managedBy || "",
    aggregatedFactTableSettings:
      factTable.aggregatedFactTableSettings ?? undefined,
    dateCreated: factTable.dateCreated?.toISOString() || "",
    dateUpdated: factTable.dateUpdated?.toISOString() || "",
  };
}

export function toFactTableColumnApiInterface(
  column: ColumnInterface,
): ApiFactTableColumn {
  return {
    ...omit(column, ["dateCreated", "dateUpdated", "topValuesDate"]),
    alwaysInlineFilter: column.alwaysInlineFilter ?? false,
    isAutoSliceColumn: column.isAutoSliceColumn ?? false,
    dateCreated: column.dateCreated.toISOString(),
    dateUpdated: column.dateUpdated.toISOString(),
  };
}

export function toFactTableFilterApiInterface(
  factTable: FactTableInterface,
  filterId: string,
): ApiFactTableFilter {
  const filter = factTable.filters.find((f) => f.id === filterId);

  if (!filter) {
    throw new Error("Cannot find filter with that id");
  }

  return {
    ...omit(filter, ["dateCreated", "dateUpdated"]),
    managedBy: filter.managedBy || "",
    dateCreated: filter.dateCreated?.toISOString() || "",
    dateUpdated: filter.dateUpdated?.toISOString() || "",
  };
}
