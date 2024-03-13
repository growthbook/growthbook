import mongoose from "mongoose";
import uniqid from "uniqid";
import { omit } from "lodash";
import { migrateSavedGroup } from "@back-end/src/util/migrations";
import { ApiSavedGroup } from "@back-end/types/openapi";
import {
  CreateSavedGroupProps,
  LegacySavedGroupInterface,
  SavedGroupInterface,
  UpdateSavedGroupProps,
} from "@back-end/types/saved-group";

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
  source: String,
  condition: String,
  type: {
    type: String,
  },
  attributeKey: String,
});

type SavedGroupDocument = mongoose.Document & LegacySavedGroupInterface;

const SavedGroupModel = mongoose.model<LegacySavedGroupInterface>(
  "savedGroup",
  savedGroupSchema
);

const toInterface = (doc: SavedGroupDocument): SavedGroupInterface => {
  const legacy = omit(
    doc.toJSON<SavedGroupDocument>({ flattenMaps: true }),
    ["__v", "_id"]
  );

  return migrateSavedGroup(legacy);
};

export function parseSavedGroupString(list: string) {
  const values = list
    .split(",")
    .map((value) => value.trim())
    .filter((value) => !!value);

  return [...new Set(values)];
}

export async function createSavedGroup(
  organization: string,
  group: CreateSavedGroupProps
): Promise<SavedGroupInterface> {
  const newGroup = await SavedGroupModel.create({
    ...group,
    id: uniqid("grp_"),
    organization,
    dateCreated: new Date(),
    dateUpdated: new Date(),
  });
  return toInterface(newGroup);
}

export async function getAllSavedGroups(
  organization: string
): Promise<SavedGroupInterface[]> {
  const savedGroups: SavedGroupDocument[] = await SavedGroupModel.find({
    organization,
  });
  return savedGroups.map(toInterface);
}

export async function getSavedGroupById(
  savedGroupId: string,
  organization: string
): Promise<SavedGroupInterface | null> {
  const savedGroup = await SavedGroupModel.findOne({
    id: savedGroupId,
    organization: organization,
  });

  return savedGroup ? toInterface(savedGroup) : null;
}

export async function updateSavedGroupById(
  savedGroupId: string,
  organization: string,
  group: UpdateSavedGroupProps
): Promise<UpdateSavedGroupProps> {
  const changes = {
    ...group,
    dateUpdated: new Date(),
  };

  await SavedGroupModel.updateOne(
    {
      id: savedGroupId,
      organization: organization,
    },
    changes
  );

  return changes;
}

export async function deleteSavedGroupById(id: string, organization: string) {
  await SavedGroupModel.deleteOne({
    id,
    organization,
  });
}

export function toSavedGroupApiInterface(
  savedGroup: SavedGroupInterface
): ApiSavedGroup {
  return {
    id: savedGroup.id,
    type: savedGroup.type,
    values: savedGroup.values || [],
    condition: savedGroup.condition || "",
    name: savedGroup.groupName,
    attributeKey: savedGroup.attributeKey || "",
    dateCreated: savedGroup.dateCreated.toISOString(),
    dateUpdated: savedGroup.dateUpdated.toISOString(),
    owner: savedGroup.owner || "",
  };
}
