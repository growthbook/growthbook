import { z } from "zod";

import { namedSchema } from "./openapi-helpers";

export const queryStatusValidator = z.enum([
  "queued",
  "running",
  "failed",
  "partially-succeeded",
  "succeeded",
]);

export const queryPointerValidator = z
  .object({
    query: z.string(),
    status: queryStatusValidator,
    name: z.string(),
  })
  .strict();

export const sqlResultChunkValidator = z
  .object({
    organization: z.string(),
    dateCreated: z.date(),
    dateUpdated: z.date(),
    id: z.string(),
    queryId: z.string(),
    chunkNumber: z.number(),
    numRows: z.number(),
    data: z.record(z.string(), z.array(z.unknown())),
  })
  .strict();

// Corresponds to schemas/Query.yaml
export const apiQueryValidator = namedSchema(
  "Query",
  z
    .object({
      id: z.string(),
      organization: z.string(),
      datasource: z.string(),
      language: z.string(),
      query: z.string(),
      queryType: z.string(),
      createdAt: z.string(),
      startedAt: z.string(),
      status: z.enum([
        "running",
        "queued",
        "failed",
        "partially-succeeded",
        "succeeded",
      ]),
      externalId: z.string(),
      dependencies: z.array(z.string()),
      runAtEnd: z.boolean(),
    })
    .strict(),
);

export type ApiQuery = z.infer<typeof apiQueryValidator>;

const idParams = z
  .object({
    id: z.string().describe("The id of the requested resource"),
  })
  .strict();

export const getQueryValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: idParams,
  responseSchema: z
    .object({
      query: apiQueryValidator,
    })
    .strict(),
  summary: "Get a single query",
  operationId: "getQuery",
  tags: ["queries"],
  method: "get" as const,
  path: "/queries/:id",
  exampleRequest: { params: { id: "abc123" } },
};
