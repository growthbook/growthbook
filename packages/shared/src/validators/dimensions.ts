import { z } from "zod";
import { ownerField, ownerInputField } from "./owner-field";
import { apiPaginationFieldsValidator, paginationQueryFields } from "./shared";

import { namedSchema } from "./openapi-helpers";

// Corresponds to schemas/Dimension.yaml
export const apiDimensionValidator = namedSchema(
  "Dimension",
  z
    .object({
      id: z.string(),
      dateCreated: z.string(),
      dateUpdated: z.string(),
      owner: ownerField,
      datasourceId: z.string(),
      identifierType: z.string(),
      name: z.string(),
      description: z.string().optional(),
      query: z.string(),
      managedBy: z
        .enum(["", "api", "config"])
        .describe(
          "Where this dimension must be managed from. If not set (empty string), it can be managed from anywhere.",
        )
        .optional(),
    })
    .strict(),
);

export type ApiDimension = z.infer<typeof apiDimensionValidator>;

// Corresponds to payload-schemas/PostDimensionPayload.yaml
const postDimensionBody = z
  .object({
    name: z.string().describe("Name of the dimension"),
    description: z.string().describe("Description of the dimension").optional(),
    owner: ownerInputField.optional(),
    datasourceId: z
      .string()
      .describe("ID of the datasource this dimension belongs to"),
    identifierType: z
      .string()
      .describe("Type of identifier (user, anonymous, etc.)"),
    query: z.string().describe("SQL query or equivalent for the dimension"),
    managedBy: z
      .enum(["", "api"])
      .describe(
        "Where this dimension must be managed from. If not set (empty string), it can be managed from anywhere.",
      )
      .optional(),
  })
  .strict();

// Corresponds to payload-schemas/UpdateDimensionPayload.yaml
const updateDimensionBody = postDimensionBody.partial();

const idParams = z
  .object({
    id: z.string().describe("The id of the requested resource"),
  })
  .strict();

export const listDimensionsValidator = {
  bodySchema: z.never(),
  querySchema: z
    .object({
      ...paginationQueryFields,
      datasourceId: z.string().describe("Filter by Data Source").optional(),
    })
    .strict(),
  paramsSchema: z.never(),
  responseSchema: z.intersection(
    z.object({
      dimensions: z.array(apiDimensionValidator),
    }),
    apiPaginationFieldsValidator,
  ),
  summary: "Get all dimensions",
  operationId: "listDimensions",
  tags: ["dimensions"],
  method: "get" as const,
  path: "/dimensions",
};

export const postDimensionValidator = {
  bodySchema: postDimensionBody,
  querySchema: z.never(),
  paramsSchema: z.never(),
  responseSchema: z
    .object({
      dimension: apiDimensionValidator,
    })
    .strict(),
  summary: "Create a single dimension",
  operationId: "postDimension",
  tags: ["dimensions"],
  method: "post" as const,
  path: "/dimensions",
  exampleRequest: {
    body: {
      name: "User Country",
      datasourceId: "ds_123abc",
      identifierType: "user",
      query: "SELECT country FROM users",
    },
  },
};

export const getDimensionValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: idParams,
  responseSchema: z
    .object({
      dimension: apiDimensionValidator,
    })
    .strict(),
  summary: "Get a single dimension",
  operationId: "getDimension",
  tags: ["dimensions"],
  method: "get" as const,
  path: "/dimensions/:id",
  exampleRequest: { params: { id: "abc123" } },
};

export const updateDimensionValidator = {
  bodySchema: updateDimensionBody,
  querySchema: z.never(),
  paramsSchema: idParams,
  responseSchema: z
    .object({
      dimension: apiDimensionValidator,
    })
    .strict(),
  summary: "Update a single dimension",
  operationId: "updateDimension",
  tags: ["dimensions"],
  method: "post" as const,
  path: "/dimensions/:id",
  exampleRequest: {
    params: { id: "abc123" },
    body: { name: "User Region" },
  },
};

export const deleteDimensionValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: idParams,
  responseSchema: z
    .object({
      deletedId: z
        .string()
        .describe("The ID of the deleted dimension")
        .meta({ example: "dim_123abc" }),
    })
    .strict(),
  summary: "Deletes a single dimension",
  operationId: "deleteDimension",
  tags: ["dimensions"],
  method: "delete" as const,
  path: "/dimensions/:id",
  exampleRequest: { params: { id: "abc123" } },
};
