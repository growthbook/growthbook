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
} from "back-end/types/fact-table";
import { ApiFactTable, ApiFactTableFilter } from "back-end/types/openapi";
import { ReqContext } from "back-end/types/organization";
import { ApiReqContext } from "back-end/types/api";

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
      deleted: Boolean,
      alwaysInlineFilter: Boolean,
      topValues: [String],
      topValuesDate: Date,
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
});

factTableSchema.index({ id: 1, organization: 1 }, { unique: true });

type FactTableDocument = mongoose.Document & FactTableInterface;

const FactTableModel = mongoose.model<FactTableInterface>(
  "FactTable",
  factTableSchema
);

function toInterface(doc: FactTableDocument): FactTableInterface {
  const ret = doc.toJSON<FactTableDocument>();
  return omit(ret, ["__v", "_id"]);
}

function createPropsToInterface(
  context: ReqContext | ApiReqContext,
  rawProps: CreateFactTableProps
): FactTableInterface {
  const props = { ...rawProps, owner: rawProps.owner || context.userName };
  const id = props.id || uniqid("ftb_");
  if (!id.match(/^[-a-zA-Z0-9_]+$/)) {
    throw new Error(
      "Fact table ids must contain only letters, numbers, underscores, and dashes"
    );
  }

  const columns: ColumnInterface[] = props.columns
    ? props.columns.map((column) => {
        return {
          ...column,
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
  };
}

export async function getAllFactTablesForOrganization(
  context: ReqContext | ApiReqContext
) {
  const docs = await FactTableModel.find({ organization: context.org.id });
  return docs
    .map((doc) => toInterface(doc))
    .filter((f) => context.permissions.canReadMultiProjectResource(f.projects));
}

export async function getFactTablesForDatasource(
  context: ReqContext,
  datasource: string
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
  context: ReqContext | ApiReqContext
): Promise<FactTableMap> {
  const factTables = await getAllFactTablesForOrganization(context);

  return new Map(factTables.map((f) => [f.id, f]));
}

export async function getFactTable(
  context: ReqContext | ApiReqContext,
  id: string
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

export async function createFactTable(
  context: ReqContext | ApiReqContext,
  data: CreateFactTableProps
) {
  const doc = await FactTableModel.create(
    createPropsToInterface(context, data)
  );

  const factTable = toInterface(doc);
  return factTable;
}

export async function createFactTables(
  context: ReqContext,
  factTables: Omit<CreateFactTableProps, "datasource">[],
  datasource: string
): Promise<FactTableInterface[]> {
  const factTablesToCreate = factTables.map((factTable) =>
    createPropsToInterface(context, { ...factTable, datasource })
  );

  return (await FactTableModel.insertMany(factTablesToCreate)).map(toInterface);
}

export async function updateFactTable(
  context: ReqContext | ApiReqContext,
  factTable: FactTableInterface,
  changes: UpdateFactTableProps
) {
  if (factTable.managedBy === "api" && context.auditUser?.type !== "api_key") {
    throw new Error("This fact table is managed by the API");
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
    }
  );
}

// This is called from a background cronjob to re-sync all of the columns
// It doesn't need to check for 'managedBy' and doesn't need to set 'dateUpdated'
export async function updateFactTableColumns(
  factTable: FactTableInterface,
  changes: Partial<Pick<FactTableInterface, "columns" | "columnsError">>
) {
  await FactTableModel.updateOne(
    {
      id: factTable.id,
      organization: factTable.organization,
    },
    {
      $set: changes,
    }
  );
}

export async function updateColumn(
  factTable: FactTableInterface,
  column: string,
  changes: UpdateColumnProps
) {
  const columnIndex = factTable.columns.findIndex((c) => c.column === column);
  if (columnIndex < 0) throw new Error("Could not find that column");

  if (
    changes.alwaysInlineFilter &&
    (changes.datatype || factTable.columns[columnIndex]?.datatype) !== "string"
  ) {
    throw new Error("Only string columns are eligible for inline filtering");
  }

  factTable.columns[columnIndex] = {
    ...factTable.columns[columnIndex],
    ...changes,
    ...(changes.topValues ? { topValuesDate: new Date() } : {}),
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
        columns: factTable.columns,
      },
    }
  );
}

export async function createFactFilter(
  factTable: FactTableInterface,
  data: CreateFactFilterProps
) {
  if (!factTable.managedBy && data.managedBy) {
    throw new Error(
      "Cannot create a filter managed by API unless the Fact Table is also managed by API"
    );
  }

  const id = data.id || uniqid("flt_");
  if (!id.match(/^[-a-zA-Z0-9_]+$/)) {
    throw new Error(
      "Fact table filter ids must contain only letters, numbers, underscores, and dashes"
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
    }
  );

  return filter;
}

export async function updateFactFilter(
  context: ReqContext | ApiReqContext,
  factTable: FactTableInterface,
  filterId: string,
  changes: UpdateFactFilterProps
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
    }
  );
}

export async function deleteFactTable(
  context: ReqContext | ApiReqContext,
  factTable: FactTableInterface
) {
  if (factTable.managedBy === "api" && context.auditUser?.type !== "api_key") {
    throw new Error("This fact table is managed by the API");
  }

  await FactTableModel.deleteOne({
    id: factTable.id,
    organization: factTable.organization,
  });
}

export async function deleteFactFilter(
  context: ReqContext | ApiReqContext,
  factTable: FactTableInterface,
  filterId: string
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
    }
  );
}

export function toFactTableApiInterface(
  factTable: FactTableInterface
): ApiFactTable {
  return {
    ...omit(factTable, [
      "organization",
      "columns",
      "filters",
      "dateCreated",
      "dateUpdated",
    ]),
    managedBy: factTable.managedBy || "",
    dateCreated: factTable.dateCreated?.toISOString() || "",
    dateUpdated: factTable.dateUpdated?.toISOString() || "",
  };
}

export function toFactTableFilterApiInterface(
  factTable: FactTableInterface,
  filterId: string
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
