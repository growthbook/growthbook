import mongoose from "mongoose";
import uniqid from "uniqid";
import { omit } from "lodash";
import { ArchetypeInterface } from "../../types/archetype";

const archetypeSchema = new mongoose.Schema({
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
  isPublic: Boolean,
  dateCreated: Date,
  dateUpdated: Date,
  attributes: String,
});

type ArchetypeDocument = mongoose.Document & ArchetypeInterface;

const ArchetypeModel = mongoose.model<ArchetypeInterface>(
  "archetype",
  archetypeSchema
);

type CreateArchetypeProps = Omit<
  ArchetypeInterface,
  "dateCreated" | "dateUpdated" | "id"
>;

type UpdateArchetypeProps = Omit<
  ArchetypeInterface,
  "dateCreated" | "dateUpdated" | "id" | "organization" | "attributeKey"
>;

const toInterface = (doc: ArchetypeDocument): ArchetypeInterface =>
  omit(
    doc.toJSON<ArchetypeDocument>({ flattenMaps: true }),
    ["__v", "_id"]
  );

export function parseArchetypeString(list: string) {
  const values = list
    .split(",")
    .map((value) => value.trim())
    .filter((value) => !!value);

  return [...new Set(values)];
}

export async function createArchetype(
  user: CreateArchetypeProps
): Promise<ArchetypeInterface> {
  const newUser = await ArchetypeModel.create({
    ...user,
    id: uniqid("sam_"),
    dateCreated: new Date(),
    dateUpdated: new Date(),
  });
  return toInterface(newUser);
}

export async function getAllArchetypes(
  organization: string,
  owner: string
): Promise<ArchetypeInterface[]> {
  const archetype: ArchetypeDocument[] = await ArchetypeModel.find({
    organization,
  });
  return (
    archetype
      .filter((su) => su.owner === owner || su.isPublic)
      .map((value) => value.toJSON()) || []
  );
}

export async function getArchetypeById(
  archetypeId: string,
  organization: string
): Promise<ArchetypeInterface | null> {
  const archetype = await ArchetypeModel.findOne({
    id: archetypeId,
    organization: organization,
  });

  return archetype ? toInterface(archetype) : null;
}

export async function updateArchetypeById(
  archetypeId: string,
  organization: string,
  user: UpdateArchetypeProps
): Promise<UpdateArchetypeProps> {
  const changes = {
    ...user,
    dateUpdated: new Date(),
  };

  await ArchetypeModel.updateOne(
    {
      id: archetypeId,
      organization: organization,
    },
    changes
  );

  return changes;
}

export async function deleteArchetypeById(id: string, organization: string) {
  await ArchetypeModel.deleteOne({
    id,
    organization,
  });
}
