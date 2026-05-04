import { z } from "zod";

import { namedSchema } from "./openapi-helpers";
import {
  apiPaginationFieldsValidator,
  paginationQueryFields,
} from "./shared";

// ---------------------------------------------------------------------------
// Internal (Mongo) shape
// Matches walkthrough §4.2 db.contextualBanditQueries
// ---------------------------------------------------------------------------

/**
 * One declared context attribute on a Contextual Bandit Assignment Query.
 * Boolean is intentionally rejected — boolean attributes should be modeled as
 * two-valued strings so they participate in the regression tree splits.
 */
export const cbaqAttributeValidator = z
  .object({
    name: z.string().min(1),
    column: z.string().min(1),
    datatype: z.enum(["string", "number"]),
    topValues: z.array(z.string()).default([]),
    topValuesDate: z.date().optional(),
    dateCreated: z.date(),
    dateUpdated: z.date(),
    deleted: z.boolean().default(false),
  })
  .strict();
export type CBAQAttribute = z.infer<typeof cbaqAttributeValidator>;

export const contextualBanditQueryValidator = z
  .object({
    id: z.string(),
    organization: z.string(),
    datasource: z.string(),
    name: z.string().min(1),
    description: z.string().optional(),
    identifierType: z.string().min(1),
    sql: z.string().min(1),
    attributes: z.array(cbaqAttributeValidator).default([]),
    dateCreated: z.date(),
    dateUpdated: z.date(),
  })
  .strict();
export type ContextualBanditQueryInterface = z.infer<
  typeof contextualBanditQueryValidator
>;

// ---------------------------------------------------------------------------
// API-shape (ISO date strings) and named OpenAPI schema
// ---------------------------------------------------------------------------

const apiCbaqAttribute = z
  .object({
    name: z.string(),
    column: z.string(),
    datatype: z.enum(["string", "number"]),
    topValues: z.array(z.string()),
    topValuesDate: z.string().meta({ format: "date-time" }).optional(),
    dateCreated: z.string().meta({ format: "date-time" }),
    dateUpdated: z.string().meta({ format: "date-time" }),
    deleted: z.boolean(),
  })
  .strict();

export const apiContextualBanditQueryValidator = namedSchema(
  "ContextualBanditQuery",
  z
    .object({
      id: z.string(),
      datasourceId: z.string(),
      name: z.string(),
      description: z.string().optional(),
      identifierType: z.string(),
      sql: z.string(),
      attributes: z.array(apiCbaqAttribute),
      dateCreated: z.string().meta({ format: "date-time" }),
      dateUpdated: z.string().meta({ format: "date-time" }),
    })
    .strict(),
);
export type ApiContextualBanditQuery = z.infer<
  typeof apiContextualBanditQueryValidator
>;

// ---------------------------------------------------------------------------
// API request bodies
// ---------------------------------------------------------------------------

const cbaqAttributeInput = z
  .object({
    name: z.string().min(1).describe("Display name for the attribute"),
    column: z
      .string()
      .min(1)
      .describe("Column on the SQL query result that holds this attribute"),
    datatype: z
      .enum(["string", "number"])
      .describe("Datatype of the attribute"),
  })
  .strict();

export const apiCreateContextualBanditQueryBody = z
  .object({
    datasourceId: z.string().describe("ID of the parent datasource"),
    name: z.string().min(1).describe("Name of the contextual bandit query"),
    description: z.string().optional(),
    identifierType: z
      .string()
      .min(1)
      .describe("Identifier type that the SQL emits"),
    sql: z
      .string()
      .min(1)
      .describe(
        "SQL query that produces one row per assignment with the declared context attributes",
      ),
    attributes: z
      .array(cbaqAttributeInput)
      .describe("Context attributes available to the bandit")
      .optional(),
  })
  .strict();

export const apiUpdateContextualBanditQueryBody =
  apiCreateContextualBanditQueryBody.partial();

// ---------------------------------------------------------------------------
// Route validators (OpenAPI doc shape)
// ---------------------------------------------------------------------------

const idParams = z
  .object({
    id: z.string().describe("The id of the requested resource"),
  })
  .strict();

export const listContextualBanditQueriesValidator = {
  bodySchema: z.never(),
  querySchema: z
    .object({
      ...paginationQueryFields,
      datasourceId: z.string().describe("Filter by datasource id").optional(),
    })
    .strict(),
  paramsSchema: z.never(),
  responseSchema: z.intersection(
    z.object({
      contextualBanditQueries: z.array(apiContextualBanditQueryValidator),
    }),
    apiPaginationFieldsValidator,
  ),
  summary: "Get all contextual bandit queries",
  operationId: "listContextualBanditQueries",
  tags: ["contextual-bandit-queries"],
  method: "get" as const,
  path: "/contextual-bandit-queries",
};

export const getContextualBanditQueryValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: idParams,
  responseSchema: z
    .object({ contextualBanditQuery: apiContextualBanditQueryValidator })
    .strict(),
  summary: "Get a single contextual bandit query",
  operationId: "getContextualBanditQuery",
  tags: ["contextual-bandit-queries"],
  method: "get" as const,
  path: "/contextual-bandit-queries/:id",
};

export const postContextualBanditQueryValidator = {
  bodySchema: apiCreateContextualBanditQueryBody,
  querySchema: z.never(),
  paramsSchema: z.never(),
  responseSchema: z
    .object({ contextualBanditQuery: apiContextualBanditQueryValidator })
    .strict(),
  summary: "Create a single contextual bandit query",
  operationId: "postContextualBanditQuery",
  tags: ["contextual-bandit-queries"],
  method: "post" as const,
  path: "/contextual-bandit-queries",
};

export const updateContextualBanditQueryValidator = {
  bodySchema: apiUpdateContextualBanditQueryBody,
  querySchema: z.never(),
  paramsSchema: idParams,
  responseSchema: z
    .object({ contextualBanditQuery: apiContextualBanditQueryValidator })
    .strict(),
  summary: "Update a single contextual bandit query",
  operationId: "updateContextualBanditQuery",
  tags: ["contextual-bandit-queries"],
  method: "put" as const,
  path: "/contextual-bandit-queries/:id",
};

export const deleteContextualBanditQueryValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: idParams,
  responseSchema: z
    .object({
      deletedId: z
        .string()
        .describe("The ID of the deleted contextual bandit query")
        .meta({ example: "cbaq_123abc" }),
    })
    .strict(),
  summary: "Delete a single contextual bandit query",
  operationId: "deleteContextualBanditQuery",
  tags: ["contextual-bandit-queries"],
  method: "delete" as const,
  path: "/contextual-bandit-queries/:id",
};

// ---------------------------------------------------------------------------
// Custom endpoint validators (test, refresh-top-values, attributes CRUD)
// ---------------------------------------------------------------------------

const cbaqNullRateEntry = z.object({
  column: z.string(),
  pct: z.number(),
});

export const apiTestContextualBanditQueryValidator = {
  bodySchema: z
    .object({
      sampleSize: z
        .number()
        .int()
        .min(1)
        .max(10000)
        .describe("Number of rows to sample (default 1000)")
        .optional(),
    })
    .strict()
    .optional(),
  querySchema: z.never(),
  paramsSchema: idParams,
  responseSchema: z
    .object({
      ok: z.boolean(),
      error: z.string().optional(),
      missingColumns: z.array(z.string()).optional(),
      nullRate: z.array(cbaqNullRateEntry).optional(),
    })
    .strict(),
  summary: "Test a contextual bandit query",
  operationId: "testContextualBanditQuery",
  tags: ["contextual-bandit-queries"],
  method: "post" as const,
  path: "/contextual-bandit-queries/:id/test",
};

export const apiRefreshTopValuesValidator = {
  bodySchema: z.never().optional(),
  querySchema: z.never(),
  paramsSchema: idParams,
  responseSchema: z
    .object({
      jobId: z.string(),
      status: z.literal("running"),
    })
    .strict(),
  summary: "Refresh cached top values for a contextual bandit query",
  operationId: "refreshContextualBanditQueryTopValues",
  tags: ["contextual-bandit-queries"],
  method: "post" as const,
  path: "/contextual-bandit-queries/:id/refresh-top-values",
};

export const apiAddCbaqAttributeValidator = {
  bodySchema: cbaqAttributeInput,
  querySchema: z.never(),
  paramsSchema: idParams,
  responseSchema: z
    .object({ contextualBanditQuery: apiContextualBanditQueryValidator })
    .strict(),
  summary: "Add an attribute to a contextual bandit query",
  operationId: "addContextualBanditQueryAttribute",
  tags: ["contextual-bandit-queries"],
  method: "post" as const,
  path: "/contextual-bandit-queries/:id/attributes",
};

const idAndColumnParams = z
  .object({
    id: z.string(),
    column: z.string(),
  })
  .strict();

export const apiUpdateCbaqAttributeValidator = {
  bodySchema: cbaqAttributeInput.partial().strict(),
  querySchema: z.never(),
  paramsSchema: idAndColumnParams,
  responseSchema: z
    .object({ contextualBanditQuery: apiContextualBanditQueryValidator })
    .strict(),
  summary: "Update an attribute on a contextual bandit query",
  operationId: "updateContextualBanditQueryAttribute",
  tags: ["contextual-bandit-queries"],
  method: "put" as const,
  path: "/contextual-bandit-queries/:id/attributes/:column",
};

export const apiDeleteCbaqAttributeValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: idAndColumnParams,
  responseSchema: z
    .object({ contextualBanditQuery: apiContextualBanditQueryValidator })
    .strict(),
  summary: "Soft-delete an attribute on a contextual bandit query",
  operationId: "deleteContextualBanditQueryAttribute",
  tags: ["contextual-bandit-queries"],
  method: "delete" as const,
  path: "/contextual-bandit-queries/:id/attributes/:column",
};
