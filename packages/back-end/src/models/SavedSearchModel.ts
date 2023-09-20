import mongoose from "mongoose";
import uniqid from "uniqid";
import { omit } from "lodash";
import { SavedSearchInterface } from "../../types/experiment";

const savedSearchSchema = new mongoose.Schema({
  id: {
    type: String,
    unique: true,
  },
  organization: {
    type: String,
    index: true,
  },
  name: String,
  description: String,
  owner: String,
  dateCreated: Date,
  dateUpdated: Date,
  tags: [String],
  public: Boolean,
  filters: {},
  show: {},
  sort: {},
  display: String,
});

type SavedSearchDocument = mongoose.Document & SavedSearchInterface;

const SavedSearchModel = mongoose.model<SavedSearchInterface>(
  "savedSearch",
  savedSearchSchema
);

type CreateSavedSearchProps = Omit<
  SavedSearchInterface,
  "dateCreated" | "dateUpdated" | "id"
>;

type UpdateSavedSearchProps = Omit<
  SavedSearchInterface,
  "dateCreated" | "dateUpdated" | "id" | "organization" | "owner"
>;

const toInterface = (doc: SavedSearchDocument): SavedSearchInterface =>
  omit(
    doc.toJSON<SavedSearchDocument>({ flattenMaps: true }),
    ["__v", "_id"]
  );
export async function createSavedSearch(
  search: CreateSavedSearchProps
): Promise<SavedSearchInterface> {
  const newSearch = await SavedSearchModel.create({
    ...search,
    id: uniqid("ser_"),
    dateCreated: new Date(),
    dateUpdated: new Date(),
  });
  return toInterface(newSearch);
}

export async function getAllSavedSearches(
  organization: string
): Promise<SavedSearchInterface[]> {
  const savedSearches: SavedSearchDocument[] = await SavedSearchModel.find({
    organization,
  });
  return savedSearches.map((value) => value.toJSON()) || [];
}

export async function getSavedSearchById(
  savedSearchId: string,
  organization: string
): Promise<SavedSearchInterface | null> {
  const savedSearch = await SavedSearchModel.findOne({
    id: savedSearchId,
    organization: organization,
  });

  return savedSearch ? toInterface(savedSearch) : null;
}

export async function updateSavedSearchById(
  savedSearchId: string,
  organization: string,
  savedSearch: UpdateSavedSearchProps
): Promise<UpdateSavedSearchProps> {
  const changes = {
    ...savedSearch,
    dateUpdated: new Date(),
  };

  await SavedSearchModel.updateOne(
    {
      id: savedSearchId,
      organization: organization,
    },
    changes
  );

  return changes;
}

export async function deleteSavedSearchById(id: string, organization: string) {
  await SavedSearchModel.deleteOne({
    id,
    organization,
  });
}
