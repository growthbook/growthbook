import mongoose from "mongoose";
import uniqid from "uniqid";
import { omit } from "lodash";
import { getLegacySavedGroupValues } from "shared/util";
import { ApiSavedGroup } from "../../types/openapi";
import { SavedGroupInterface } from "../../types/saved-group";
import {
  OrganizationInterface,
  SDKAttributeSchema,
} from "../../types/organization";
import { AttributeMap } from "../services/features";

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
  condition: String,
  source: String,
  attributeKey: String,
});

type SavedGroupDocument = mongoose.Document & SavedGroupInterface;

const SavedGroupModel = mongoose.model<SavedGroupInterface>(
  "savedGroup",
  savedGroupSchema
);

type LegacySavedGroup = SavedGroupInterface & {
  values?: string[];
};

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

function getGroupValues(values: string[], type?: string): string[] | number[] {
  if (type === "number") {
    return values.map((v) => parseFloat(v));
  }
  return values;
}

const toInterface = (
  doc: SavedGroupDocument,
  attributes?: SDKAttributeSchema | undefined
): SavedGroupInterface => {
  const group = omit(
    doc.toJSON<SavedGroupDocument>({ flattenMaps: true }),
    ["__v", "_id"]
  );

  const attributeMap: AttributeMap = new Map();
  attributes?.forEach((attribute) => {
    attributeMap.set(attribute.property, attribute.datatype);
  });

  // JIT migration for old documents
  if (!group.source) group.source = "inline";
  if (
    group.source === "inline" &&
    !group.condition &&
    (group as LegacySavedGroup).values &&
    group.attributeKey
  ) {
    group.condition = JSON.stringify({
      [group.attributeKey]: {
        $in: getGroupValues(
          (group as LegacySavedGroup).values || [],
          attributeMap.get(group.attributeKey)
        ),
      },
    });
  }
  group.condition = group.condition || "";

  return group;
};

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
  organization: OrganizationInterface
): Promise<SavedGroupInterface[]> {
  const savedGroups: SavedGroupDocument[] = await SavedGroupModel.find({
    organization: organization.id,
  });
  return savedGroups.map((doc) =>
    toInterface(doc, organization?.settings?.attributeSchema)
  );
}

export async function getSavedGroupById(
  savedGroupId: string,
  organization: OrganizationInterface
): Promise<SavedGroupInterface | null> {
  const savedGroup = await SavedGroupModel.findOne({
    id: savedGroupId,
    organization: organization.id,
  });

  return savedGroup
    ? toInterface(savedGroup, organization?.settings?.attributeSchema)
    : null;
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
  await SavedGroupModel.deleteOne({
    id,
    organization,
  });
}

export function toSavedGroupApiInterface(
  savedGroup: SavedGroupInterface
): ApiSavedGroup {
  const values =
    savedGroup.source === "inline"
      ? getLegacySavedGroupValues(savedGroup.condition, savedGroup.attributeKey)
      : [];

  // Populate the `values` field from legacy saved groups with a really simple condition

  return {
    id: savedGroup.id,
    values: values.map((v) => v + ""),
    name: savedGroup.groupName,
    attributeKey: savedGroup.attributeKey,
    dateCreated: savedGroup.dateCreated.toISOString(),
    dateUpdated: savedGroup.dateUpdated.toISOString(),
    owner: savedGroup.owner || "",
    source: savedGroup.source,
    condition: savedGroup.condition || "",
  };
}
