import { omit } from "lodash";
import mongoose from "mongoose";
import uniqid from "uniqid";
import { SavedQueryInterface } from "shared/src/savedQueries";

const savedQuerySchema = new mongoose.Schema({
  id: {
    type: String,
    unique: true,
  },
  organization: {
    type: String,
    index: true,
  },
  name: String,
  owner: String,
  dateCreated: Date,
  dateUpdated: Date,
  query: String,
  results: String,
  // projects: [String],
});

type SavedQueryDocument = mongoose.Document & SavedQueryInterface;

const SavedQueryModel = mongoose.model<SavedQueryInterface>(
  "savedQuery",
  savedQuerySchema
);

const toInterface = (doc: SavedQueryDocument): SavedQueryInterface => {
  return omit(doc.toJSON<SavedQueryDocument>({ flattenMaps: true }), [
    "__v",
    "_id",
  ]);
};

export async function createSavedQuery(
  orgId: string,
  owner: string,
  savedQuery: any
) {
  const newQuery = await SavedQueryModel.create({
    ...savedQuery,
    organization: orgId,
    id: uniqid("query_"),
    owner,
    dateCreated: new Date(),
    dateUpdated: new Date(),
  });

  return toInterface(newQuery);
}
