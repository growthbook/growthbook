import mongoose from "mongoose";
import uniqid from "uniqid";
import { omit } from "lodash";
import { ApiSavedGroup } from "../../types/openapi";
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
  source: String,
  attributeKey: String,
});

type SavedGroupDocument = mongoose.Document & SavedGroupInterface;

const SavedGroupModel = mongoose.model<SavedGroupInterface>(
  "savedGroup",
  savedGroupSchema
);

type CreateSavedGroupProps = Omit<
  SavedGroupInterface,
  "dateCreated" | "dateUpdated" | "id"
>;

export type UpdateSavedGroupProps = Partial<
  Omit<
    SavedGroupInterface,
    "dateCreated" | "dateUpdated" | "id" | "organization" | "source"
  >
>;

const toInterface = (doc: SavedGroupDocument): SavedGroupInterface => {
  const group = omit(
    doc.toJSON<SavedGroupDocument>({ flattenMaps: true }),
    ["__v", "_id"]
  );

  // JIT migration - before we had a 'source' field all saved groups were defined inline
  if (!group.source) group.source = "inline";

  return group;
};

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

export async function getRuntimeSavedGroup(
  key: string,
  organization: string
): Promise<SavedGroupInterface | null> {
  const savedGroup = await SavedGroupModel.findOne({
    attributeKey: key,
    source: "runtime",
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
  if (usingFileConfig()) {
    throw new Error("Cannot delete. Saved Groups managed by config.yml");
  }

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
    values: savedGroup.values,
    name: savedGroup.groupName,
    attributeKey: savedGroup.attributeKey,
    dateCreated: savedGroup.dateCreated.toISOString(),
    dateUpdated: savedGroup.dateUpdated.toISOString(),
    owner: savedGroup.owner || "",
    source: savedGroup.source,
  };
}
