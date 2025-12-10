import mongoose from "mongoose";
import uniqid from "uniqid";
import { SavedGroupInterface } from "shared/types/groups";
import { ApiSavedGroup } from "back-end/types/openapi";
import {
  CreateSavedGroupProps,
  LegacySavedGroupInterface,
  UpdateSavedGroupProps,
} from "back-end/types/saved-group";
import {
  ToInterface,
  getCollection,
  removeMongooseFields,
} from "back-end/src/util/mongo.util";
import { migrateSavedGroup } from "back-end/src/util/migrations";

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
  description: String,
  projects: [String],
  // Previously, empty saved groups were ignored in the SDK payload, making all $inGroup operations return true
  useEmptyListGroup: Boolean,
});

const SavedGroupModel = mongoose.model<LegacySavedGroupInterface>(
  "savedGroup",
  savedGroupSchema,
);

const COLLECTION = "savedgroups";

const toInterface: ToInterface<SavedGroupInterface> = (doc) => {
  const legacy = removeMongooseFields(doc);

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
  group: CreateSavedGroupProps,
): Promise<SavedGroupInterface> {
  const newGroup = await SavedGroupModel.create({
    ...group,
    id: uniqid("grp_"),
    organization,
    dateCreated: new Date(),
    dateUpdated: new Date(),
    useEmptyListGroup: true,
  });
  return toInterface(newGroup);
}

export async function getAllSavedGroups(
  organization: string,
): Promise<SavedGroupInterface[]> {
  const savedGroups = await getCollection(COLLECTION)
    .find({
      organization,
    })
    .toArray();

  return savedGroups.map(toInterface);
}

export async function getSavedGroupById(
  savedGroupId: string,
  organization: string,
): Promise<SavedGroupInterface | null> {
  const savedGroup = await getCollection(COLLECTION).findOne({
    id: savedGroupId,
    organization: organization,
  });

  return savedGroup ? toInterface(savedGroup) : null;
}

export async function getSavedGroupsById(
  savedGroupIds: string[],
  organization: string,
): Promise<SavedGroupInterface[]> {
  const savedGroups = await getCollection(COLLECTION)
    .find({
      id: { $in: savedGroupIds || [] },
      organization: organization,
    })
    .toArray();

  return savedGroups ? savedGroups.map((group) => toInterface(group)) : [];
}

export async function updateSavedGroupById(
  savedGroupId: string,
  organization: string,
  group: UpdateSavedGroupProps,
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
    changes,
  );

  return changes;
}

export async function removeProjectFromSavedGroups(
  project: string,
  organization: string,
) {
  await SavedGroupModel.updateMany(
    { organization, projects: project },
    { $pull: { projects: project } },
  );
}

export async function deleteSavedGroupById(id: string, organization: string) {
  await SavedGroupModel.deleteOne({
    id,
    organization,
  });
}

export function toSavedGroupApiInterface(
  savedGroup: SavedGroupInterface,
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
    description: savedGroup.description,
    projects: savedGroup.projects || [],
  };
}
