import mongoose, { FilterQuery } from "mongoose";
import uniqid from "uniqid";
import {
  getFactMetricColumnRefs,
  sqlReferencesColumn,
} from "shared/experiments";
import { explorationConfigReferencesColumn } from "shared/enterprise";
import { SqlIdentifierQuote } from "shared/types/sql";
import { isEqual, omit } from "lodash";
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
import { isEventForwarderEventsFactTable } from "shared/util";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";
import { promiseAllChunks } from "back-end/src/util/promise";
import { projectFilterQuery } from "back-end/src/util/mongo.util";
import { createModelAuditLogger } from "back-end/src/services/audit";
import { deferAggregatedFactTableToNextSlot } from "back-end/src/services/aggregatedFactTables";
import {
  definitionsScope,
  touchDefinitionsVersion,
} from "back-end/src/models/DefinitionsVersionModel";
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
      dataTypeFromWarehouse: String,
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

export function createPropsToInterface(
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
  await touchDefinitionsVersion(
    context.org.id,
    definitionsScope(factTable.projects),
  );

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
  // The Event Forwarder Events fact table is `managedBy: "api"` but is
  // intentionally user-editable for now.
  if (
    !isEventForwarderEventsFactTable(factTable, factTable.datasource) &&
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

  // Bail on a no-op save before writing anything — the front-end resubmits the
  // whole form on every save, and some API clients re-PUT the same definition
  // on a schedule. Not writing means there is nothing to invalidate, so the
  // write and the definitions-version bump stay in lockstep.
  const changed = Object.entries(changes).some(
    ([k, v]) => !isEqual(factTable[k as keyof FactTableInterface], v),
  );
  if (!changed) return;

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

  await touchDefinitionsVersion(
    factTable.organization,
    definitionsScope(
      factTable.projects,
      changes.projects ?? factTable.projects,
    ),
  );
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

  // Only bump the definitions version if something actually changed — this runs
  // from a background cron on every fact table, so an unconditional touch would
  // churn the version and tank the ETag hit rate.
  const changedDefinitionFields = Object.entries(safeChanges).some(
    ([k, v]) => !isEqual(factTable[k as keyof FactTableInterface], v),
  );
  if (changedDefinitionFields) {
    await touchDefinitionsVersion(
      factTable.organization,
      definitionsScope(factTable.projects),
    );
  }

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
  // No-op sync: skip the write entirely so we neither churn the definitions
  // version nor drift dateUpdated (which is part of the definitions payload).
  if (
    (Object.keys(changes) as (keyof typeof changes)[]).every((k) =>
      isEqual(factTable[k], changes[k]),
    )
  ) {
    return;
  }

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
  await touchDefinitionsVersion(
    factTable.organization,
    definitionsScope(factTable.projects),
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
  await touchDefinitionsVersion(
    factTable.organization,
    definitionsScope(factTable.projects),
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
//
// The scan is org-wide and deliberately ignores the caller's read permissions:
// deleting a column is destructive and cross-cutting, so a dependent the caller
// happens to not be able to read must still block the delete. Using a
// read-filtered `getAll()` here would under-report and let the delete through,
// leaving that exploration or dashboard generating SQL for a column that no
// longer exists. A dependent the caller cannot read still blocks the delete but
// must not be named in the error, so those are counted in `hiddenCount` instead.
async function getDependentExplorationsAndDashboards(
  context: ReqContext | ApiReqContext,
  factTable: FactTableInterface,
  columnName: string,
  identifierQuote: SqlIdentifierQuote,
): Promise<{
  explorations: Array<{ id: string; name?: string }>;
  dashboards: Array<{ id: string; name?: string }>;
  hiddenCount: number;
}> {
  const [
    allExplorations,
    allDashboards,
    visibleExplorations,
    visibleDashboards,
  ] = await Promise.all([
    context.models.analyticsExplorations.dangerousGetAllForDependencyScan(),
    context.models.dashboards.dangerousGetAllForDependencyScan(),
    context.models.analyticsExplorations.getAll(),
    context.models.dashboards.getAll(),
  ]);

  const visibleExplorationIds = new Set(visibleExplorations.map((e) => e.id));
  const visibleDashboardIds = new Set(visibleDashboards.map((d) => d.id));

  const dependentExplorations = allExplorations.filter((e) =>
    explorationConfigReferencesColumn(
      e.config,
      factTable.id,
      columnName,
      identifierQuote,
      factTable.filters,
    ),
  );

  const dependentDashboards = allDashboards.filter((d) =>
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
  );

  const explorations = dependentExplorations
    .filter((e) => visibleExplorationIds.has(e.id))
    .map((e) => ({ id: e.id }));

  const dashboards = dependentDashboards
    .filter((d) => visibleDashboardIds.has(d.id))
    .map((d) => ({ id: d.id, name: d.title }));

  const hiddenCount =
    dependentExplorations.length -
    explorations.length +
    (dependentDashboards.length - dashboards.length);

  return { explorations, dashboards, hiddenCount };
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
  // Org-wide for the same reason as explorations/dashboards below: a metric in a
  // project the caller cannot read must still block the delete.
  const [allFactMetrics, visibleFactMetrics] = await Promise.all([
    context.models.factMetrics.dangerousGetAllForDependencyScan(),
    context.models.factMetrics.getAll(),
  ]);
  const visibleFactMetricIds = new Set(visibleFactMetrics.map((m) => m.id));
  const allDependentMetrics = allFactMetrics.filter((metric) =>
    getFactMetricColumnRefs(metric).some((columnRef) =>
      columnRefReferencesColumn(
        columnRef,
        columnName,
        factTable,
        identifierQuote,
      ),
    ),
  );
  const dependentMetrics = allDependentMetrics.filter((m) =>
    visibleFactMetricIds.has(m.id),
  );
  const hiddenMetricCount =
    allDependentMetrics.length - dependentMetrics.length;

  // Explorations and dashboard blocks persist column references (valueColumn,
  // dimensions, row filters) that resolve through the same query-time
  // chokepoint, so a virtual column they use must not be deleted out from
  // under them.
  const {
    explorations: dependentExplorations,
    dashboards: dependentDashboards,
    hiddenCount,
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
  // Counted, not named, so the error never reveals resources the caller cannot
  // read — while still blocking the delete.
  const totalHidden = hiddenCount + hiddenMetricCount;
  if (totalHidden > 0) {
    lines.push(
      `\n - ${totalHidden} other resource(s) you do not have access to`,
    );
  }
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

  await touchDefinitionsVersion(
    factTable.organization,
    definitionsScope(factTable.projects),
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
  await touchDefinitionsVersion(
    factTable.organization,
    definitionsScope(factTable.projects),
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

  const existingFilter = filters[filterIndex];

  if (
    factTable.managedBy === "api" &&
    existingFilter?.managedBy === "api" &&
    context.auditUser?.type !== "api_key"
  ) {
    throw new Error("This fact filter is managed by the API");
  }

  // Bail on a no-op save before writing — see updateFactTable. Returning here
  // also avoids rewriting the whole filters array from a snapshot a concurrent
  // write may already have superseded.
  const changed = Object.entries(changes).some(
    ([k, v]) => !isEqual(existingFilter[k as keyof FactFilterInterface], v),
  );
  if (!changed) return;

  filters[filterIndex] = {
    ...existingFilter,
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

  await touchDefinitionsVersion(
    factTable.organization,
    definitionsScope(factTable.projects),
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
    !isEventForwarderEventsFactTable(factTable, factTable.datasource) &&
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
  await touchDefinitionsVersion(
    factTable.organization,
    definitionsScope(factTable.projects),
  );
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
  await touchDefinitionsVersion(
    factTable.organization,
    definitionsScope(factTable.projects),
  );
}

export function toFactTableApiInterface(
  factTable: FactTableInterface,
): ApiFactTable {
  const apiFactTable: { [K in keyof Required<ApiFactTable>]: ApiFactTable[K] } =
    {
      id: factTable.id,
      name: factTable.name,
      description: factTable.description,
      owner: factTable.owner,
      // Populated downstream by resolveOwnerEmail; listed here so the exhaustive
      // type stays satisfied.
      ownerEmail: undefined,
      projects: factTable.projects,
      tags: factTable.tags,
      datasource: factTable.datasource,
      userIdTypes: factTable.userIdTypes,
      aggregatedFactTableSettings:
        factTable.aggregatedFactTableSettings ?? undefined,
      sql: factTable.sql,
      eventName: factTable.eventName,
      columns: factTable.columns.map(toFactTableColumnApiInterface),
      columnsError: factTable.columnsError,
      columnRefreshPending: factTable.columnRefreshPending ?? false,
      archived: factTable.archived,
      autoSliceUpdatesEnabled: factTable.autoSliceUpdatesEnabled,
      managedBy: factTable.managedBy || "",
      dateCreated: factTable.dateCreated?.toISOString() || "",
      dateUpdated: factTable.dateUpdated?.toISOString() || "",
    };
  return apiFactTable;
}

export function toFactTableColumnApiInterface(
  column: ColumnInterface,
): ApiFactTableColumn {
  return {
    column: column.column,
    datatype: column.datatype,
    dataTypeFromWarehouse: column.dataTypeFromWarehouse,
    numberFormat: column.numberFormat,
    jsonFields: column.jsonFields,
    name: column.name,
    description: column.description,
    alwaysInlineFilter: column.alwaysInlineFilter ?? false,
    deleted: column.deleted,
    isAutoSliceColumn: column.isAutoSliceColumn ?? false,
    autoSlices: column.autoSlices,
    lockedAutoSlices: column.lockedAutoSlices,
    isVirtual: column.isVirtual,
    sql: column.sql,
    topValues: column.topValues,
    topValuesDate: column.topValuesDate?.toISOString(),
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
