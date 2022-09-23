import mongoose from "mongoose";
import { SavedGroupInterface } from "../../types/saved-group";
import uniqid from "uniqid";

const savedGroupSchema = new mongoose.Schema({
  id: {
    type: String,
    unique: true,
  },
  orgId: {
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

function parseSaveGroupString(list: string) {
  const listArr = list.split(",");

  const savedGroup = listArr.map((i: string) => {
    return i.trim();
  });

  return [
    ...new Set(savedGroup.filter((value) => value !== "," && value !== "")),
  ];
}

type SavedGroupEditableProps = Omit<
  SavedGroupInterface,
  "dateCreated" | "dateUpdated" | "id" | "values"
>;

export async function createSavedGroup(
  values: string,
  group: SavedGroupEditableProps
): Promise<SavedGroupInterface> {
  const newGroup = await SavedGroupModel.create({
    ...group,
    values: parseSaveGroupString(values),
    id: uniqid("grp_"),
    dateCreated: new Date(),
    dateUpdated: new Date(),
  });
  return newGroup.toJSON();
}

export async function getAllSavedGroups(
  orgId: string
): Promise<SavedGroupInterface[]> {
  const savedGroups = await SavedGroupModel.find({ orgId });
  return savedGroups.map((value) => value.toJSON()) || [];
}

export async function updateSavedGroup(
  values: string,
  group: SavedGroupEditableProps
): Promise<void> {
  await SavedGroupModel.updateOne(
    { groupName: group.groupName },
    {
      ...group,
      values: parseSaveGroupString(values),
      dateUpdated: new Date(),
    }
  );
}
