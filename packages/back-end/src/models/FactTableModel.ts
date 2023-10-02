import mongoose from "mongoose";
import uniqid from "uniqid";
import { omit } from "lodash";
import {
  CreateFactFilterProps,
  CreateFactProps,
  CreateFactTableProps,
  FactFilterInterface,
  FactInterface,
  FactTableInterface,
  UpdateFactFilterProps,
  UpdateFactProps,
  UpdateFactTableProps,
} from "../../types/fact-table";

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
  facts: [
    {
      _id: false,
      id: String,
      name: String,
      dateCreated: Date,
      dateUpdated: Date,
      description: String,
      column: String,
      numberFormat: String,
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
  const doc = await FactTableModel.create({
    organization: organization,
    id: data.id || uniqid("ftb_"),
    name: data.name,
    description: data.description,
    dateCreated: new Date(),
    dateUpdated: new Date(),
    datasource: data.datasource,
    facts: [],
    filters: [],
    owner: data.owner,
    projects: data.projects,
    tags: data.tags,
    sql: data.sql,
    userIdTypes: data.userIdTypes,
  });
  return toInterface(doc);
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

export async function createFact(
  factTable: FactTableInterface,
  data: CreateFactProps
) {
  const fact: FactInterface = {
    id: data.id || uniqid("fct_"),
    name: data.name,
    dateCreated: new Date(),
    dateUpdated: new Date(),
    column: data.column,
    numberFormat: data.numberFormat,
    description: data.description,
  };

  if (factTable.facts.some((f) => f.id === fact.id)) {
    throw new Error("Fact id already exists in this fact table");
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
        facts: fact,
      },
    }
  );

  return fact;
}

export async function updateFact(
  factTable: FactTableInterface,
  factId: string,
  changes: UpdateFactProps
) {
  const factIndex = factTable.facts.findIndex((f) => f.id === factId);
  if (factIndex < 0) throw new Error("Could not find fact with that id");

  factTable.facts[factIndex] = {
    ...factTable.facts[factIndex],
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
        facts: factTable.facts,
      },
    }
  );
}

export async function createFactFilter(
  factTable: FactTableInterface,
  data: CreateFactFilterProps
) {
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

export async function deleteFact(
  factTable: FactTableInterface,
  factId: string
) {
  const newFacts = factTable.facts.filter((f) => f.id !== factId);

  if (newFacts.length === factTable.facts.length) {
    throw new Error("Could not find fact with that id");
  }

  await FactTableModel.updateOne(
    {
      id: factTable.id,
      organization: factTable.organization,
    },
    {
      $set: {
        dateUpdated: new Date(),
        facts: newFacts,
      },
    }
  );
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
