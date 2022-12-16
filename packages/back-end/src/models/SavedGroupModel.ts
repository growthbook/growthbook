import mongoose from "mongoose";
import uniqid from "uniqid";
import { SavedGroupInterface } from "../../types/saved-group";
import { usingFileConfig } from "../init/config";

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

export function parseSavedGroupString(list: string) {
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
): Promise<UpdateSavedGroupProps> {
  const changes = {
    ...group,
    dateUpdated: new Date(),
  };

  await SavedGroupModel.update(
    {
      id: savedGroupId,
      organization: organization,
    },
    changes
  );

  return changes;
}

export async function deleteSavedGroupById(id: string, organization: string) {
  if (usingFileConfig()) {
    throw new Error("Cannot delete. Saved Groups managed by config.yml");
  }

  await SavedGroupModel.deleteOne({
    id,
    organization,
  });
}
