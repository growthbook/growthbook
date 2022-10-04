import mongoose from "mongoose";
import { SavedGroupInterface } from "../../types/saved-group";
import uniqid from "uniqid";

const savedGroupSchema = new mongoose.Schema({
  id: {
    type: String,
    unique: true,
  },
  organization: {
    type: String,
    index: true,
  },
  groupName: String,
  owner: String,
  dateCreated: Date,
  dateUpdated: Date,
  values: [String],
  attributeKey: String,
});

type SavedGroupDocument = mongoose.Document & SavedGroupInterface;

const SavedGroupModel = mongoose.model<SavedGroupDocument>(
  "savedGroup",
  savedGroupSchema
);

type CreateSavedGroupProps = Omit<
  SavedGroupInterface,
  "dateCreated" | "dateUpdated" | "id"
>;

type UpdateSavedGroupProps = Omit<
  SavedGroupInterface,
  "dateCreated" | "dateUpdated" | "id" | "organization" | "attributeKey"
>;

export function parseSaveGroupString(list: string) {
  const values = list
    .split(",")
    .map((value) => value.trim())
    .filter((value) => !!value);

  return [...new Set(values)];
}

export async function createSavedGroup(
  group: CreateSavedGroupProps
): Promise<SavedGroupInterface> {
  const newGroup = await SavedGroupModel.create({
    ...group,
    id: uniqid("grp_"),
    dateCreated: new Date(),
    dateUpdated: new Date(),
  });
  return newGroup.toJSON();
}

export async function getAllSavedGroups(
  organization: string
): Promise<SavedGroupInterface[]> {
  const savedGroups = await SavedGroupModel.find({ organization });
  return savedGroups.map((value) => value.toJSON()) || [];
}

export async function getSavedGroupById(
  savedGroupId: string,
  organization: string
): Promise<SavedGroupInterface | null> {
  const savedGroup = await SavedGroupModel.findOne({
    id: savedGroupId,
    organization: organization,
  });

  return savedGroup?.toJSON() || null;
}

export async function updateSavedGroup(
  savedGroupId: string,
  organization: string,
  group: UpdateSavedGroupProps
): Promise<SavedGroupInterface | null> {
  const updatedGroup = await SavedGroupModel.findOneAndUpdate(
    {
      id: savedGroupId,
      organization: organization,
    },
    {
      ...group,
      dateUpdated: new Date(),
    },
    { useFindAndModify: false }
  );

  return updatedGroup?.toJSON() || null;
}
