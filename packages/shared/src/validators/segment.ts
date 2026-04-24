import { z } from "zod";
import { ownerEmailField, ownerField, ownerInputField } from "./owner-field";
import { apiPaginationFieldsValidator, paginationQueryFields } from "./shared";

import { namedSchema } from "./openapi-helpers";

const TYPES = ["SQL", "FACT"] as const;

export const segmentValidator = z
  .object({
    id: z.string(),
    organization: z.string(),
    owner: ownerField,
    datasource: z.string(),
    dateCreated: z.date(),
    dateUpdated: z.date(),
    name: z.string(),
    description: z.string(),
    userIdType: z.string(),
    type: z.enum(TYPES),
    managedBy: z.enum(["", "api", "config"]).optional(),
    sql: z.string().optional(),
    factTableId: z.string().optional(),
    filters: z.array(z.string()).optional(),
    projects: z.array(z.string()).optional(),
  })
  .strict();

export const createSegmentModelValidator = segmentValidator.omit({
  id: true,
  organization: true,
  dateCreated: true,
  dateUpdated: true,
});

export const updateSegmentModelValidator = segmentValidator.omit({
  id: true,
  organization: true,
  dateCreated: true,
  dateUpdated: true,
});

// --- API validators (migrated from openapi.ts) ---

// Corresponds to schemas/Segment.yaml
export const apiSegmentValidator = namedSchema(
  "Segment",
  z
    .object({
      id: z.string(),
      owner: ownerField,
      ownerEmail: ownerEmailField,
      datasourceId: z.string(),
      identifierType: z.string(),
      name: z.string(),
      description: z.string().optional(),
      query: z.string().optional(),
      dateCreated: z.string(),
      dateUpdated: z.string(),
      managedBy: z
        .enum(["", "api", "config"])
        .describe(
          "Where this segment must be managed from. If not set (empty string), it can be managed from anywhere.",
        )
        .optional(),
      type: z.enum(["SQL", "FACT"]).optional(),
      factTableId: z.string().optional(),
      filters: z.array(z.string()).optional(),
      projects: z.array(z.string()).optional(),
    })
    .strict(),
);

export type ApiSegment = z.infer<typeof apiSegmentValidator>;

// Corresponds to payload-schemas/PostSegmentPayload.yaml
const postSegmentBody = z
  .object({
    name: z.string().describe("Name of the segment"),
    owner: ownerInputField.optional(),
    description: z.string().describe("Description of the segment").optional(),
    datasourceId: z
      .string()
      .describe("ID of the datasource this segment belongs to"),
    identifierType: z
      .string()
      .describe("Type of identifier (user, anonymous, etc.)"),
    projects: z
      .array(z.string())
      .describe("List of project IDs for projects that can access this segment")
      .optional(),
    managedBy: z
      .enum(["", "api"])
      .describe(
        "Where this Segment must be managed from. If not set (empty string), it can be managed from anywhere.",
      )
      .optional(),
    type: z
      .enum(["SQL", "FACT"])
      .describe(
        "GrowthBook supports two types of Segments, SQL and FACT. SQL segments are defined by a SQL query, and FACT segments are defined by a fact table and filters.",
      ),
    query: z
      .string()
      .describe(
        "SQL query that defines the Segment. This is required for SQL segments.",
      )
      .optional(),
    factTableId: z
      .string()
      .describe(
        "ID of the fact table this segment belongs to. This is required for FACT segments.",
      )
      .optional(),
    filters: z
      .array(z.string())
      .describe(
        "Optional array of fact table filter ids that can further define the Fact Table based Segment.",
      )
      .optional(),
  })
  .strict();

// Corresponds to payload-schemas/UpdateSegmentPayload.yaml
const updateSegmentBody = postSegmentBody.partial();

const idParams = z
  .object({
    id: z.string().describe("The id of the requested resource"),
  })
  .strict();

export const listSegmentsValidator = {
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
      segments: z.array(apiSegmentValidator),
    }),
    apiPaginationFieldsValidator,
  ),
  summary: "Get all segments",
  operationId: "listSegments",
  tags: ["segments"],
  method: "get" as const,
  path: "/segments",
};

export const postSegmentValidator = {
  bodySchema: postSegmentBody,
  querySchema: z.never(),
  paramsSchema: z.never(),
  responseSchema: z
    .object({
      segment: apiSegmentValidator,
    })
    .strict(),
  summary: "Create a single segment",
  operationId: "postSegment",
  tags: ["segments"],
  method: "post" as const,
  path: "/segments",
  exampleRequest: {
    body: {
      name: "Annual Subscribers",
      datasourceId: "ds_123abc",
      identifierType: "user_id",
      type: "SQL" as const,
      query: "SELECT plan FROM subscribers WHERE plan = ",
    },
  },
};

export const getSegmentValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: idParams,
  responseSchema: z
    .object({
      segment: apiSegmentValidator,
    })
    .strict(),
  summary: "Get a single segment",
  operationId: "getSegment",
  tags: ["segments"],
  method: "get" as const,
  path: "/segments/:id",
  exampleRequest: { params: { id: "abc123" } },
};

export const updateSegmentValidator = {
  bodySchema: updateSegmentBody,
  querySchema: z.never(),
  paramsSchema: idParams,
  responseSchema: z
    .object({
      segment: apiSegmentValidator,
    })
    .strict(),
  summary: "Update a single segment",
  operationId: "updateSegment",
  tags: ["segments"],
  method: "post" as const,
  path: "/segments/:id",
  exampleRequest: {
    params: { id: "abc123" },
    body: { name: "User Region" },
  } as const,
};

export const deleteSegmentValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: idParams,
  responseSchema: z
    .object({
      deletedId: z
        .string()
        .describe("The ID of the deleted segment")
        .meta({ example: "seg_123abc" }),
    })
    .strict(),
  summary: "Deletes a single segment",
  operationId: "deleteSegment",
  tags: ["segments"],
  method: "delete" as const,
  path: "/segments/:id",
  exampleRequest: { params: { id: "abc123" } },
};
