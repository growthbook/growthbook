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
} from "../../types/fact-table";
import { EventAuditUser } from "../events/event-types";
import { ApiFactTable, ApiFactTableFilter } from "../../types/openapi";

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

export async function getAllFactTablesForOrganization(organization: string) {
  const docs = await FactTableModel.find({ organization });
  return docs.map((doc) => toInterface(doc));
}

export type FactTableMap = Map<string, FactTableInterface>;

export async function getFactTableMap(
  organization: string
): Promise<FactTableMap> {
  const factTables = await getAllFactTablesForOrganization(organization);

  return new Map(factTables.map((f) => [f.id, f]));
}

export async function getFactTable(organization: string, id: string) {
  const doc = await FactTableModel.findOne({ organization, id });
  return doc ? toInterface(doc) : null;
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
    managedBy: data.managedBy || "",
  });

  const factTable = toInterface(doc);
  return factTable;
}

export async function updateFactTable(
  factTable: FactTableInterface,
  changes: UpdateFactTableProps,
  user: EventAuditUser
) {
  if (factTable.managedBy === "api" && user?.type !== "api_key") {
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
  factTable: FactTableInterface,
  filterId: string,
  changes: UpdateFactFilterProps,
  user: EventAuditUser
) {
  const filters = [...factTable.filters];

  const filterIndex = filters.findIndex((f) => f.id === filterId);
  if (filterIndex < 0) throw new Error("Could not find filter with that id");

  if (
    factTable.managedBy === "api" &&
    filters[filterIndex]?.managedBy === "api" &&
    user?.type !== "api_key"
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
  factTable: FactTableInterface,
  user: EventAuditUser
) {
  if (factTable.managedBy === "api" && user?.type !== "api_key") {
    throw new Error("This fact table is managed by the API");
  }

  await FactTableModel.deleteOne({
    id: factTable.id,
    organization: factTable.organization,
  });
}

export async function deleteFactFilter(
  factTable: FactTableInterface,
  filterId: string,
  user: EventAuditUser
) {
  const filter = factTable.filters.find((f) => f.id === filterId);

  if (
    factTable.managedBy === "api" &&
    filter?.managedBy === "api" &&
    user?.type !== "api_key"
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
