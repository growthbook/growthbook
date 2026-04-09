import { z } from "zod";
import { namedSchema } from "./openapi-utils";

export const apiArchetypeInterface = namedSchema(
  "Archetype",
  z.strictObject({
    id: z.string(),
    dateCreated: z.string(),
    dateUpdated: z.string(),
    name: z.string(),
    description: z.string().optional(),
    owner: z.string(),
    isPublic: z.boolean(),
    attributes: z
      .record(z.string(), z.unknown())
      .describe("The attributes to set when using this Archetype"),
    projects: z.array(z.string()).optional(),
  }),
);

const idParams = z.strictObject({ id: z.string() });

const archetypeBody = z.strictObject({
  name: z.string(),
  description: z.string().optional(),
  isPublic: z
    .boolean()
    .describe("Whether to make this Archetype available to other team members"),
  attributes: z
    .record(z.string(), z.unknown())
    .describe("The attributes to set when using this Archetype")
    .optional(),
  projects: z.array(z.string()).optional(),
});
export const listArchetypesValidator = {
  summary: "Get the organization's archetypes",
  operationId: "listArchetypes",
  tags: ["archetypes"],
  responseSchema: z.strictObject({
    archetypes: z.array(apiArchetypeInterface),
  }),
};

export const postArchetypeValidator = {
  summary: "Create a single archetype",
  operationId: "postArchetype",
  tags: ["archetypes"],
  bodySchema: archetypeBody,
  responseSchema: z.strictObject({ archetype: apiArchetypeInterface }),
  exampleRequest: {
    body: {
      name: "Power Users",
      description: "Users who log in daily",
      isPublic: true,
      attributes: { login_frequency: "daily", plan: "premium" },
    },
  },
};

export const getArchetypeValidator = {
  summary: "Get a single archetype",
  operationId: "getArchetype",
  tags: ["archetypes"],
  paramsSchema: idParams,
  responseSchema: z.strictObject({ archetype: apiArchetypeInterface }),
  exampleRequest: {
    params: { id: "arch_abc123" },
  },
};

export const putArchetypeValidator = {
  summary: "Update a single archetype",
  operationId: "putArchetype",
  tags: ["archetypes"],
  paramsSchema: idParams,
  bodySchema: archetypeBody.partial(),
  responseSchema: z.strictObject({ archetype: apiArchetypeInterface }),
};

export const deleteArchetypeValidator = {
  summary: "Deletes a single archetype",
  operationId: "deleteArchetype",
  tags: ["archetypes"],
  paramsSchema: idParams,
  responseSchema: z.strictObject({ deletedId: z.string() }),
};
