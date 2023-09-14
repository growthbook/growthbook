import mongoose from "mongoose";
import uniqid from "uniqid";
import { omit } from "lodash";
import {
  CreateFactProps,
  CreateFactTableProps,
  FactInterface,
  FactTableInterface,
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
  tags: [String],
  projects: [String],
  datasource: String,
  userIdTypes: [String],
  sql: String,
  facts: [
    {
      _id: false,
      id: String,
      name: String,
      description: String,
      type: String,
      column: String,
      numberFormat: String,
      where: String,
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

export async function getFactTable(organization: string, id: string) {
  const doc = await FactTableModel.findOne({ organization, id });
  return doc ? toInterface(doc) : null;
}

export async function createFactTable(
  organization: string,
  data: CreateFactTableProps
) {
  // TODO: validation
  const doc = await FactTableModel.create({
    organization: organization,
    id: data.id || uniqid("ftb_"),
    name: data.name,
    description: data.description,
    dateCreated: new Date(),
    dateUpdated: new Date(),
    datasource: data.datasource,
    facts: [],
    owner: data.owner,
    projects: data.projects,
    sql: data.sql,
    tags: data.tags,
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
    type: data.type,
    numberFormat: data.numberFormat,
    description: data.description,
    where: data.where,
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
