import { z } from "zod";
import { ownerField } from "./owner-field";
import { namedSchema } from "./openapi-helpers";

// Corresponds to schemas/Archetype.yaml
export const apiArchetypeValidator = namedSchema(
  "Archetype",
  z
    .object({
      id: z.string(),
      dateCreated: z.string(),
      dateUpdated: z.string(),
      name: z.string(),
      description: z.string().optional(),
      owner: ownerField,
      isPublic: z.boolean(),
      attributes: z
        .record(z.string(), z.any())
        .describe("The attributes to set when using this Archetype"),
      projects: z.array(z.string()).optional(),
    })
    .strict(),
);

export type ApiArchetype = z.infer<typeof apiArchetypeValidator>;

// Corresponds to payload-schemas/PostArchetypePayload.yaml
const postArchetypeBody = z
  .object({
    name: z.string(),
    description: z.string().optional(),
    isPublic: z
      .boolean()
      .describe(
        "Whether to make this Archetype available to other team members",
      ),
    attributes: z
      .record(z.string(), z.any())
      .describe("The attributes to set when using this Archetype")
      .optional(),
    projects: z.array(z.string()).optional(),
  })
  .strict();

// Corresponds to payload-schemas/PutArchetypePayload.yaml
const putArchetypeBody = postArchetypeBody.partial();

const idParams = z
  .object({
    id: z.string().describe("The id of the requested resource"),
  })
  .strict();

export const listArchetypesValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: z.never(),
  responseSchema: z
    .object({
      archetypes: z.array(apiArchetypeValidator),
    })
    .strict(),
  summary: "Get the organization's archetypes",
  operationId: "listArchetypes",
  tags: ["archetypes"],
  method: "get" as const,
  path: "/archetypes",
};

export const postArchetypeValidator = {
  bodySchema: postArchetypeBody,
  querySchema: z.never(),
  paramsSchema: z.never(),
  responseSchema: z
    .object({
      archetype: apiArchetypeValidator,
    })
    .strict(),
  summary: "Create a single archetype",
  operationId: "postArchetype",
  tags: ["archetypes"],
  method: "post" as const,
  path: "/archetypes",
};

export const getArchetypeValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: idParams,
  responseSchema: z
    .object({
      archetype: apiArchetypeValidator,
    })
    .strict(),
  summary: "Get a single archetype",
  operationId: "getArchetype",
  tags: ["archetypes"],
  method: "get" as const,
  path: "/archetypes/:id",
  exampleRequest: { params: { id: "abc123" } },
};

export const putArchetypeValidator = {
  bodySchema: putArchetypeBody,
  querySchema: z.never(),
  paramsSchema: idParams,
  responseSchema: z
    .object({
      archetype: apiArchetypeValidator,
    })
    .strict(),
  summary: "Update a single archetype",
  operationId: "putArchetype",
  tags: ["archetypes"],
  method: "put" as const,
  path: "/archetypes/:id",
  exampleRequest: {
    params: { id: "abc123" },
    body: { description: "New description" },
  },
};

export const deleteArchetypeValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: idParams,
  responseSchema: z
    .object({
      deletedId: z.string(),
    })
    .strict(),
  summary: "Deletes a single archetype",
  operationId: "deleteArchetype",
  tags: ["archetypes"],
  method: "delete" as const,
  path: "/archetypes/:id",
  exampleRequest: { params: { id: "abc123" } },
};
