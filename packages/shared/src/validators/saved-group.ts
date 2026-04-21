import { z } from "zod";
import { ownerField, ownerInputField } from "./owner-field";
import { apiPaginationFieldsValidator, paginationQueryFields } from "./shared";

import { namedSchema } from "./openapi-helpers";

export const savedGroupTypeValidator = z.enum(["condition", "list"]);

export const savedGroupValidator = z
  .object({
    id: z.string(),
    organization: z.string(),
    groupName: z.string(),
    owner: ownerField,
    type: savedGroupTypeValidator,
    condition: z.string().optional(),
    attributeKey: z.string().optional(),
    values: z.array(z.string()).optional(),
    dateUpdated: z.date(),
    dateCreated: z.date(),
    description: z.string().optional(),
    projects: z.array(z.string()).optional(),
    useEmptyListGroup: z.boolean().optional(),
  })
  .strict();

export const postSavedGroupBodyValidator = z.object({
  groupName: z.string(),
  owner: ownerInputField,
  type: savedGroupTypeValidator,
  condition: z.string().optional(),
  attributeKey: z.string().optional(),
  values: z.string().array().optional(),
  description: z.string().optional(),
  projects: z.string().array().optional(),
});

export const putSavedGroupBodyValidator = z.object({
  groupName: z.string().optional(),
  owner: ownerInputField.optional(),
  values: z.string().array().optional(),
  condition: z.string().optional(),
  description: z.string().optional(),
  projects: z.string().array().optional(),
});

// --- External API validators (correspond to YAML specs) ---

// Corresponds to schemas/SavedGroup.yaml
export const apiSavedGroupValidator = namedSchema(
  "SavedGroup",
  z
    .object({
      id: z.string(),
      type: z.enum(["condition", "list"]),
      dateCreated: z.string().meta({ format: "date-time" }),
      dateUpdated: z.string().meta({ format: "date-time" }),
      name: z.string(),
      owner: ownerField.optional(),
      condition: z
        .string()
        .describe(
          "When type = 'condition', this is the JSON-encoded condition for the group",
        )
        .optional(),
      attributeKey: z
        .string()
        .describe(
          "When type = 'list', this is the attribute key the group is based on",
        )
        .optional(),
      values: z
        .array(z.string())
        .describe(
          "When type = 'list', this is the list of values for the attribute key",
        )
        .optional(),
      description: z.string().optional(),
      projects: z.array(z.string()).optional(),
    })
    .strict(),
);

export type ApiSavedGroup = z.infer<typeof apiSavedGroupValidator>;

// Post body from postSavedGroup.yaml requestBody
const postSavedGroupBody = z
  .object({
    name: z.string().describe("The display name of the Saved Group"),
    type: z
      .enum(["condition", "list"])
      .describe(
        "The type of Saved Group (inferred from other arguments if missing)",
      )
      .optional(),
    condition: z
      .string()
      .describe(
        "When type = 'condition', this is the JSON-encoded condition for the group",
      )
      .optional(),
    attributeKey: z
      .string()
      .describe(
        "When type = 'list', this is the attribute key the group is based on",
      )
      .optional(),
    values: z
      .array(z.string())
      .describe(
        "When type = 'list', this is the list of values for the attribute key",
      )
      .optional(),
    owner: ownerInputField.optional(),
    projects: z.array(z.string()).optional(),
  })
  .strict();

// Update body from updateSavedGroup.yaml requestBody
const updateSavedGroupBody = z
  .object({
    name: z.string().describe("The display name of the Saved Group").optional(),
    condition: z
      .string()
      .describe(
        "When type = 'condition', this is the JSON-encoded condition for the group",
      )
      .optional(),
    values: z
      .array(z.string())
      .describe(
        "When type = 'list', this is the list of values for the attribute key",
      )
      .optional(),
    owner: ownerInputField.optional(),
    projects: z.array(z.string()).optional(),
  })
  .strict();

const idParams = z
  .object({
    id: z.string().describe("The id of the requested resource"),
  })
  .strict();

export const listSavedGroupsValidator = {
  bodySchema: z.never(),
  querySchema: z
    .object({
      ...paginationQueryFields,
    })
    .strict(),
  paramsSchema: z.never(),
  responseSchema: z.intersection(
    z.object({
      savedGroups: z.array(apiSavedGroupValidator),
    }),
    apiPaginationFieldsValidator,
  ),
  summary: "Get all saved group",
  operationId: "listSavedGroups",
  tags: ["saved-groups"],
  method: "get" as const,
  path: "/saved-groups",
};

export const postSavedGroupValidator = {
  bodySchema: postSavedGroupBody,
  querySchema: z.never(),
  paramsSchema: z.never(),
  responseSchema: z
    .object({
      savedGroup: apiSavedGroupValidator,
    })
    .strict(),
  summary: "Create a single saved group",
  operationId: "postSavedGroup",
  tags: ["saved-groups"],
  method: "post" as const,
  path: "/saved-groups",
  exampleRequest: {
    body: {
      name: "interal-users",
      values: ["userId-123", "userId-345", "userId-678"],
      attributeKey: "userId",
      owner: "",
    },
  },
};

export const getSavedGroupValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: idParams,
  responseSchema: z
    .object({
      savedGroup: apiSavedGroupValidator,
    })
    .strict(),
  summary: "Get a single saved group",
  operationId: "getSavedGroup",
  tags: ["saved-groups"],
  method: "get" as const,
  path: "/saved-groups/:id",
  exampleRequest: { params: { id: "abc123" } },
};

export const updateSavedGroupValidator = {
  bodySchema: updateSavedGroupBody,
  querySchema: z.never(),
  paramsSchema: idParams,
  responseSchema: z
    .object({
      savedGroup: apiSavedGroupValidator,
    })
    .strict(),
  summary: "Partially update a single saved group",
  operationId: "updateSavedGroup",
  tags: ["saved-groups"],
  method: "post" as const,
  path: "/saved-groups/:id",
  exampleRequest: {
    params: { id: "abc123" },
    body: { values: ["userId-123", "userId-345"] },
  },
};

export const deleteSavedGroupValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: idParams,
  responseSchema: z
    .object({
      deletedId: z.string(),
    })
    .strict(),
  summary: "Deletes a single saved group",
  operationId: "deleteSavedGroup",
  tags: ["saved-groups"],
  method: "delete" as const,
  path: "/saved-groups/:id",
  exampleRequest: { params: { id: "abc123" } },
};
