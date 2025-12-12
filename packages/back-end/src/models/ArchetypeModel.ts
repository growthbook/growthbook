import mongoose, { FilterQuery } from "mongoose";
import uniqid from "uniqid";
import { omit } from "lodash";
import { ArchetypeInterface } from "shared/types/archetype";
import { ApiArchetype } from "back-end/types/openapi";
import { logger } from "back-end/src/util/logger";

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
  projects: [String],
  dateCreated: Date,
  dateUpdated: Date,
  attributes: String,
});

type ArchetypeDocument = mongoose.Document & ArchetypeInterface;

const ArchetypeModel = mongoose.model<ArchetypeInterface>(
  "archetype",
  archetypeSchema,
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
  omit(doc.toJSON<ArchetypeDocument>({ flattenMaps: true }), ["__v", "_id"]);

export function parseArchetypeString(list: string) {
  const values = list
    .split(",")
    .map((value) => value.trim())
    .filter((value) => !!value);

  return [...new Set(values)];
}

export async function createArchetype(
  arch: CreateArchetypeProps,
): Promise<ArchetypeInterface> {
  const newArch = await ArchetypeModel.create({
    ...arch,
    id: uniqid("sam_"),
    dateCreated: new Date(),
    dateUpdated: new Date(),
  });
  return toInterface(newArch);
}

export async function getAllArchetypes(
  organization: string,
  owner: string,
  project?: string,
): Promise<ArchetypeInterface[]> {
  const query: FilterQuery<ArchetypeDocument> = {
    organization: organization,
  };
  // if project is set, return archetypes that are either all projects
  // or are associated with the specified project.
  if (project || project === "") {
    const projectOrQuery = [
      { projects: { $exists: false } }, // legacy archetypes don't have projects
      { projects: { $eq: [] } }, // archetypes that are not associated with a project (ie, all projects)
      { projects: { $eq: project } }, // archetypes that are associated with the specified project
    ];
    if (!query["$or"]) {
      query["$or"] = projectOrQuery;
    } else {
      query["$or"].push(...projectOrQuery);
    }
  }
  const archetype: ArchetypeDocument[] = await ArchetypeModel.find(query);
  return (
    archetype
      .filter((su) => su.owner === owner || su.isPublic)
      .map((value) => value.toJSON()) || []
  );
}

export async function getArchetypeById(
  archetypeId: string,
  organization: string,
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
  archProps: UpdateArchetypeProps,
): Promise<UpdateArchetypeProps> {
  const changes = {
    ...archProps,
    dateUpdated: new Date(),
  };

  await ArchetypeModel.updateOne(
    {
      id: archetypeId,
      organization: organization,
    },
    changes,
  );

  return changes;
}

export async function deleteArchetypeById(id: string, organization: string) {
  await ArchetypeModel.deleteOne({
    id,
    organization,
  });
}

export function toArchetypeApiInterface(
  archetype: ArchetypeInterface,
): ApiArchetype {
  let parsedAttributes = {};
  try {
    parsedAttributes = JSON.parse(archetype.attributes);
  } catch {
    logger.error(
      {
        archetypeId: archetype.id,
      },
      "Failed to parse archetype attributes json",
    );
  }
  return {
    id: archetype.id,
    dateCreated: archetype.dateCreated?.toISOString() || "",
    dateUpdated: archetype.dateUpdated?.toISOString() || "",
    name: archetype.name,
    description: archetype.description,
    owner: archetype.owner || "",
    isPublic: archetype.isPublic,
    attributes: parsedAttributes,
    projects: archetype.projects || [],
  };
}
