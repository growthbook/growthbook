import { z } from "zod";
import { apiPaginationFieldsValidator, paginationQueryFields } from "./shared";

import { namedSchema } from "./openapi-helpers";

// Corresponds to schemas/CodeRef.yaml
export const apiCodeRefValidator = namedSchema(
  "CodeRef",
  z
    .object({
      organization: z.string().describe("The organization name"),
      dateUpdated: z
        .string()
        .meta({ format: "date-time" })
        .describe("When the code references were last updated"),
      feature: z.string().describe("Feature identifier"),
      repo: z.string().describe("Repository name"),
      branch: z.string().describe("Branch name"),
      platform: z
        .enum(["github", "gitlab", "bitbucket"])
        .describe("Source control platform")
        .optional(),
      refs: z.array(
        z.object({
          filePath: z
            .string()
            .describe("Path to the file containing the reference"),
          startingLineNumber: z.coerce
            .number()
            .int()
            .describe("Line number where the reference starts"),
          lines: z.string().describe("The code lines containing the reference"),
          flagKey: z.string().describe("The feature flag key referenced"),
        }),
      ),
    })
    .strict(),
);

export type ApiCodeRef = z.infer<typeof apiCodeRefValidator>;

// Corresponds to payload-schemas/PostCodeRefsPayload.yaml
const postCodeRefsBody = z
  .object({
    branch: z.string(),
    repoName: z.string(),
    refs: z.array(
      z.object({
        filePath: z.string(),
        startingLineNumber: z.number().int(),
        lines: z.string(),
        flagKey: z.string(),
        contentHash: z.string(),
      }),
    ),
  })
  .strict();

const idParams = z
  .object({
    id: z.string().describe("The id of the requested resource"),
  })
  .strict();

export const listCodeRefsValidator = {
  bodySchema: z.never(),
  querySchema: z
    .object({
      ...paginationQueryFields,
    })
    .strict(),
  paramsSchema: z.never(),
  responseSchema: z.intersection(
    z.object({
      codeRefs: z.array(apiCodeRefValidator),
    }),
    apiPaginationFieldsValidator,
  ),
  summary: "Get list of all code references for the current organization",
  operationId: "listCodeRefs",
  tags: ["code-references"],
  method: "get" as const,
  path: "/code-refs",
};

export const postCodeRefsValidator = {
  bodySchema: postCodeRefsBody,
  querySchema: z
    .object({
      deleteMissing: z
        .enum(["true", "false"])
        .describe(
          "Whether to delete code references that are no longer present in the submitted data",
        )
        .meta({ default: "false" })
        .optional(),
    })
    .strict(),
  paramsSchema: z.never(),
  responseSchema: z
    .object({
      featuresUpdated: z.array(z.string()).optional(),
    })
    .strict(),
  summary: "Submit list of code references",
  operationId: "postCodeRefs",
  tags: ["code-references"],
  method: "post" as const,
  path: "/code-refs",
  exampleRequest: {
    body: {
      branch: "main",
      repoName: "my-repo",
      refs: [
        {
          filePath: "src/app.ts",
          startingLineNumber: 16,
          lines: "...",
          flagKey: "my-feature",
          contentHash: "abc123",
        },
      ] as {
        filePath: string;
        startingLineNumber: number;
        lines: string;
        flagKey: string;
        contentHash: string;
      }[],
    },
  },
};

export const getCodeRefsValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: idParams,
  responseSchema: z
    .object({
      codeRefs: z.array(apiCodeRefValidator),
    })
    .strict(),
  summary: "Get list of code references for a single feature id",
  operationId: "getCodeRefs",
  tags: ["code-references"],
  method: "get" as const,
  path: "/code-refs/:id",
  exampleRequest: { params: { id: "abc123" } },
};
