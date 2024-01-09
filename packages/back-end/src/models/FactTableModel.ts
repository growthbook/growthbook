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
import { getConfigFactTables, usingFileConfig } from "../init/config";
import { ALLOW_CREATE_FACT_TABLES } from "../util/secrets";

const factTableSchema = new mongoose.Schema({
  id: String,
  organization: String,
  official: Boolean,
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

export async function getAllFactTablesForOrganization(organization: string) {
  const factTables: FactTableInterface[] = [];

  if (usingFileConfig()) {
    const configFactTables = getConfigFactTables(organization);
    factTables.push(...configFactTables);
  }

  const docs = await FactTableModel.find({ organization });
  factTables.push(...docs.map((doc) => toInterface(doc)));

  return factTables;
}

export type FactTableMap = Map<string, FactTableInterface>;

export async function getFactTableMap(
  organization: string
): Promise<FactTableMap> {
  const factTables = await getAllFactTablesForOrganization(organization);

  return new Map(factTables.map((f) => [f.id, f]));
}

export async function getFactTable(organization: string, id: string) {
  // First try looking in the config.yml file
  if (usingFileConfig()) {
    const configFactTables = getConfigFactTables(organization);
    const configFactTable = configFactTables.find((f) => f.id === id);
    if (configFactTable) return configFactTable;
  }

  // Fall back to looking in the database
  const doc = await FactTableModel.findOne({ organization, id });
  return doc ? toInterface(doc) : null;
}

export async function createFactTable(
  organization: string,
  data: CreateFactTableProps
) {
  if (usingFileConfig() && !ALLOW_CREATE_FACT_TABLES) {
    throw new Error("Creating fact tables is not allowed");
  }

  const doc = await FactTableModel.create({
    organization: organization,
    id: data.id || uniqid("ftb_"),
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
  });
  return toInterface(doc);
}

export async function updateFactTable(
  factTable: FactTableInterface,
  changes: UpdateFactTableProps
) {
  if (factTable.official) {
    throw new Error("Cannot update official fact tables");
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
  if (factTable.official) {
    throw new Error("Cannot update official fact tables");
  }

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
  if (factTable.official) {
    throw new Error("Cannot update official fact tables");
  }

  const filter: FactFilterInterface = {
    id: data.id || uniqid("flt_"),
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
  if (factTable.official) {
    throw new Error("Cannot update official fact tables");
  }

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
  if (factTable.official) {
    throw new Error("Cannot delete official fact tables");
  }

  await FactTableModel.deleteOne({
    id: factTable.id,
    organization: factTable.organization,
  });
}

export async function deleteFactFilter(
  factTable: FactTableInterface,
  filterId: string
) {
  if (factTable.official) {
    throw new Error("Cannot update official fact tables");
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
