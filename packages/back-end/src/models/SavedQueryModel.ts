import mongoose from "mongoose";
import uniqid from "uniqid";
import { omit } from "lodash";
import { TestQueryRow } from "back-end/src/types/Integration";
import { SavedQueryInterface } from "back-end/types/saved-query";

const savedQuerySchema = new mongoose.Schema({
  id: {
    type: String,
    unique: true,
  },
  organization: {
    type: String,
    index: true,
  },
  name: {
    type: String,
    required: true,
  },
  description: String,
  sql: {
    type: String,
    required: true,
  },
  datasourceId: {
    type: String,
    required: true,
    index: true,
  },
  results: [],
  dateCreated: Date,
  dateUpdated: Date,
  dateLastRan: Date,
});

type SavedQueryDocument = mongoose.Document & SavedQueryInterface;

const SavedQueryModel = mongoose.model<SavedQueryInterface>(
  "SavedQuery",
  savedQuerySchema
);

//MKTODO: I think we may want to switch this to being based off the BaseModel and the projects are set on the savedQuery itself
// even if that means the savedQuery and the datasource projects could be different

const toInterface = (doc: SavedQueryDocument): SavedQueryInterface => {
  return omit(
    doc.toJSON<SavedQueryDocument>({ flattenMaps: true }),
    ["__v", "_id"]
  );
};

export async function createSavedQuery(data: {
  name: string;
  organization: string;
  description?: string;
  sql: string;
  datasourceId: string;
  results?: TestQueryRow[];
  dateLastRan?: Date;
}): Promise<SavedQueryInterface> {
  const newSavedQuery = await SavedQueryModel.create({
    ...data,
    id: uniqid("sq_"),
    dateCreated: new Date(),
    dateUpdated: new Date(),
  });

  return toInterface(newSavedQuery);
}

export async function getSavedQueriesByOrg(
  organization: string
): Promise<SavedQueryInterface[]> {
  const savedQueries: SavedQueryDocument[] = await SavedQueryModel.find({
    organization,
  });

  return savedQueries.map(toInterface);
}

export async function getSavedQueryById(
  savedQueryId: string,
  organization: string
): Promise<SavedQueryInterface | null> {
  const savedQuery = await SavedQueryModel.findOne({
    id: savedQueryId,
    organization,
  });

  return savedQuery ? toInterface(savedQuery) : null;
}

export async function updateSavedQuery(
  savedQueryId: string,
  organization: string,
  updates: {
    name?: string;
    description?: string;
    sql?: string;
    datasourceId?: string;
    results?: any[];
    dateLastRan?: Date;
  }
): Promise<void> {
  const changes = {
    ...updates,
    dateUpdated: new Date(),
  };

  await SavedQueryModel.updateOne(
    {
      id: savedQueryId,
      organization,
    },
    changes
  );
}

export async function deleteSavedQuery(
  savedQueryId: string,
  organization: string
): Promise<void> {
  await SavedQueryModel.deleteOne({
    id: savedQueryId,
    organization,
  });
}
