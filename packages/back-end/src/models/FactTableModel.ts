import mongoose from "mongoose";
import uniqid from "uniqid";
import { omit } from "lodash";
import {
  CreateFactFilterProps,
  CreateFactTableProps,
  FactFilterInterface,
  FactTableInterface,
  UpdateFactFilterProps,
  UpdateColumnProps,
  UpdateFactTableProps,
  ColumnInterface,
} from "shared/types/fact-table";
import { ApiFactTable, ApiFactTableFilter } from "shared/types/openapi";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";
import { promiseAllChunks } from "back-end/src/util/promise";
import { createModelAuditLogger } from "back-end/src/services/audit";

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
  columnRefreshPending: Boolean,
});

factTableSchema.index({ id: 1, organization: 1 }, { unique: true });

type FactTableDocument = mongoose.Document & FactTableInterface;

const FactTableModel = mongoose.model<FactTableInterface>(
  "FactTable",
  factTableSchema,
);

function toInterface(doc: FactTableDocument): FactTableInterface {
  const ret = doc.toJSON<FactTableDocument>();
  return omit(ret, ["__v", "_id"]);
}

export function isAllowedApiManagedFactTableUpdate(
  factTable: Pick<FactTableInterface, "id" | "datasource">,
  changes: UpdateFactTableProps,
): boolean {
  const isManagedWarehouseChEvents =
    factTable.id === "ch_events" &&
    factTable.datasource === "managed_warehouse";

  const allowedFields = isManagedWarehouseChEvents
    ? new Set([
        "columns",
        "userIdTypes",
        "columnsError",
        "columnRefreshPending",
      ])
    : new Set(["columns", "userIdTypes"]);

  return Object.keys(changes).every((k) => allowedFields.has(k));
}

function createPropsToInterface(
  context: ReqContext | ApiReqContext,
  rawProps: CreateFactTableProps,
): FactTableInterface {
  const props = { ...rawProps, owner: rawProps.owner || context.userName };
  const id = props.id || uniqid("ftb_");
  if (!id.match(/^[-a-zA-Z0-9_]+$/)) {
    throw new Error(
      "Fact table ids must contain only letters, numbers, underscores, and dashes",
    );
  }

  const columns: ColumnInterface[] = props.columns
    ? props.columns.map((column) => {
        return {
          ...column,
          name: column.name ?? column.column,
          description: column.description ?? "",
          numberFormat: column.numberFormat ?? "",
          dateCreated: new Date(),
          dateUpdated: new Date(),
          deleted: false,
        };
      })
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
    columnRefreshPending: props.columnRefreshPending || false,
  };
}

export async function getAllFactTablesForOrganization(
  context: ReqContext | ApiReqContext,
) {
  const docs = await FactTableModel.find({ organization: context.org.id });
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

  const doc = await FactTableModel.create(
    createPropsToInterface(context, data),
  );

  const factTable = toInterface(doc);

  await audit.logCreate(context, factTable);

  return factTable;
}

export async function updateFactTable(
  context: ReqContext | ApiReqContext,
  factTable: FactTableInterface,
  changes: UpdateFactTableProps,
) {
  // Allow changing columns even for API-managed fact tables
  // and the side-effect of updating userIdTypes.
  if (
    !isAllowedApiManagedFactTableUpdate(factTable, changes) &&
    factTable.managedBy === "api" &&
    context.auditUser?.type !== "api_key"
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

// This is called from a background cronjob to re-sync all of the columns
// It doesn't need to check for 'managedBy' and doesn't need to set 'dateUpdated'
export async function updateFactTableColumns(
  factTable: FactTableInterface,
  changes: Partial<
    Pick<
      FactTableInterface,
      "columns" | "columnsError" | "columnRefreshPending" | "userIdTypes"
    >
  >,
  context?: ReqContext | ApiReqContext,
) {
  await FactTableModel.updateOne(
    {
      id: factTable.id,
      organization: factTable.organization,
    },
    {
      $set: changes,
    },
  );

  // Clean up auto slices from metrics if columns were refreshed and some were deleted
  if (context && changes.columns) {
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
  const updatedColumn = {
    ...originalColumn,
    ...changes,
    ...(changes.topValues ? { topValuesDate: new Date() } : {}),
    dateUpdated: new Date(),
  };

  // If auto slice settings changed, reset autoSlices to empty array
  if (updatedColumn.isAutoSliceColumn && !updatedColumn.autoSlices) {
    updatedColumn.autoSlices = [];
  }

  // Ensure boolean columns only save ["true", "false"]
  if (updatedColumn.datatype === "boolean" && updatedColumn.autoSlices) {
    updatedColumn.autoSlices = ["true", "false"];
  }

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
    dateCreated: factTable.dateCreated?.toISOString() || "",
    dateUpdated: factTable.dateUpdated?.toISOString() || "",
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
