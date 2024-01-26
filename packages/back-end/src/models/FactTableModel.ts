import mongoose from "mongoose";
import uniqid from "uniqid";
import { omit } from "lodash";
import { hasReadAccess } from "shared/permissions";
import {
  CreateFactFilterProps,
  CreateFactTableProps,
  FactFilterInterface,
  FactTableInterface,
  UpdateFactFilterProps,
  UpdateColumnProps,
  UpdateFactTableProps,
} from "../../types/fact-table";
import { ApiFactTable, ApiFactTableFilter } from "../../types/openapi";
import { ReqContext } from "../../types/organization";
import { ApiReqContext } from "../../types/api";

const factTableSchema = new mongoose.Schema({
  id: String,
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
    },
  ],
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

export async function getAllFactTablesForOrganization(
  context: ReqContext | ApiReqContext
) {
  const docs = await FactTableModel.find({ organization: context.org.id });
  const factTables = docs.map((doc) => toInterface(doc));
  return factTables.filter((ft) =>
    hasReadAccess(context.readAccessFilter, ft.projects)
  );
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

  return hasReadAccess(context.readAccessFilter, factTable.projects)
    ? factTable
    : null;
}

export async function createFactTable(
  organization: string,
  data: CreateFactTableProps
) {
  const id = data.id || uniqid("ftb_");
  if (!id.match(/^[-a-zA-Z0-9_]+$/)) {
    throw new Error(
      "Fact table ids must contain only letters, numbers, underscores, and dashes"
    );
  }

  const doc = await FactTableModel.create({
    organization,
    id,
    name: data.name,
    description: data.description,
    dateCreated: new Date(),
    dateUpdated: new Date(),
    datasource: data.datasource,
    filters: [],
    owner: data.owner,
    projects: data.projects,
    tags: data.tags,
    sql: data.sql,
    userIdTypes: data.userIdTypes,
    eventName: data.eventName,
    columns: data.columns || [],
    columnsError: null,
  });

  const factTable = toInterface(doc);
  return factTable;
}

export async function updateFactTable(
  factTable: FactTableInterface,
  changes: UpdateFactTableProps
) {
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

export async function updateColumn(
  factTable: FactTableInterface,
  column: string,
  changes: UpdateColumnProps
) {
  const columnIndex = factTable.columns.findIndex((c) => c.column === column);
  if (columnIndex < 0) throw new Error("Could not find that column");

  factTable.columns[columnIndex] = {
    ...factTable.columns[columnIndex],
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
        columns: factTable.columns,
      },
    }
  );
}

export async function createFactFilter(
  factTable: FactTableInterface,
  data: CreateFactFilterProps
) {
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
  factTable: FactTableInterface,
  filterId: string,
  changes: UpdateFactFilterProps
) {
  const filters = [...factTable.filters];

  const filterIndex = filters.findIndex((f) => f.id === filterId);
  if (filterIndex < 0) throw new Error("Could not find filter with that id");

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

export async function deleteFactTable(factTable: FactTableInterface) {
  await FactTableModel.deleteOne({
    id: factTable.id,
    organization: factTable.organization,
  });
}

export async function deleteFactFilter(
  factTable: FactTableInterface,
  filterId: string
) {
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
    dateCreated: filter.dateCreated?.toISOString() || "",
    dateUpdated: filter.dateUpdated?.toISOString() || "",
  };
}
