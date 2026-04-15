import { z } from "zod";
import { apiPaginationFieldsValidator, paginationQueryFields } from "./shared";

import { namedSchema } from "./openapi-helpers";

// Corresponds to schemas/SdkConnection.yaml
export const apiSdkConnectionValidator = namedSchema(
  "SdkConnection",
  z
    .object({
      id: z.string(),
      dateCreated: z.string().meta({ format: "date-time" }),
      dateUpdated: z.string().meta({ format: "date-time" }),
      name: z.string(),
      organization: z.string(),
      languages: z.array(z.string()),
      sdkVersion: z.string().optional(),
      environment: z.string(),
      project: z
        .string()
        .describe(
          "Use 'projects' instead. This is only for backwards compatibility and contains the first project only.",
        ),
      projects: z.array(z.string()).optional(),
      encryptPayload: z.boolean(),
      encryptionKey: z.string(),
      includeVisualExperiments: z.boolean().optional(),
      includeDraftExperiments: z.boolean().optional(),
      includeExperimentNames: z.boolean().optional(),
      includeRedirectExperiments: z.boolean().optional(),
      includeRuleIds: z.boolean().optional(),
      includeProjectIdInMetadata: z.boolean().optional(),
      includeCustomFieldsInMetadata: z.boolean().optional(),
      allowedCustomFieldsInMetadata: z.array(z.string()).optional(),
      includeTagsInMetadata: z.boolean().optional(),
      key: z.string(),
      proxyEnabled: z.boolean(),
      proxyHost: z.string(),
      proxySigningKey: z.string(),
      sseEnabled: z.boolean().optional(),
      hashSecureAttributes: z.boolean().optional(),
      remoteEvalEnabled: z.boolean().optional(),
      savedGroupReferencesEnabled: z.boolean().optional(),
    })
    .strict(),
);

export type ApiSdkConnection = z.infer<typeof apiSdkConnectionValidator>;

// Corresponds to payload-schemas/PostSdkConnectionPayload.yaml
const postSdkConnectionBody = z
  .object({
    name: z.string(),
    language: z.string(),
    sdkVersion: z.string().optional(),
    environment: z.string(),
    projects: z.array(z.string()).optional(),
    encryptPayload: z.boolean().optional(),
    includeVisualExperiments: z.boolean().optional(),
    includeDraftExperiments: z.boolean().optional(),
    includeExperimentNames: z.boolean().optional(),
    includeRedirectExperiments: z.boolean().optional(),
    includeRuleIds: z.boolean().optional(),
    includeProjectIdInMetadata: z.boolean().optional(),
    includeCustomFieldsInMetadata: z.boolean().optional(),
    allowedCustomFieldsInMetadata: z.array(z.string()).optional(),
    includeTagsInMetadata: z.boolean().optional(),
    proxyEnabled: z.boolean().optional(),
    proxyHost: z.string().optional(),
    hashSecureAttributes: z.boolean().optional(),
    remoteEvalEnabled: z.boolean().optional(),
    savedGroupReferencesEnabled: z.boolean().optional(),
  })
  .strict();

// Corresponds to payload-schemas/PutSdkConnectionPayload.yaml
const putSdkConnectionBody = postSdkConnectionBody.partial();

const idParams = z
  .object({
    id: z.string().describe("The id of the requested resource"),
  })
  .strict();

export const listSdkConnectionsValidator = {
  bodySchema: z.never(),
  querySchema: z
    .object({
      ...paginationQueryFields,
      projectId: z.string().describe("Filter by project id").optional(),
      withProxy: z.string().optional(),
      multiOrg: z.string().optional(),
    })
    .strict(),
  paramsSchema: z.never(),
  responseSchema: z.intersection(
    z.object({
      connections: z.array(apiSdkConnectionValidator),
    }),
    apiPaginationFieldsValidator,
  ),
  summary: "Get all sdk connections",
  operationId: "listSdkConnections",
  tags: ["sdk-connections"],
  method: "get" as const,
  path: "/sdk-connections",
};

export const postSdkConnectionValidator = {
  bodySchema: postSdkConnectionBody,
  querySchema: z.never(),
  paramsSchema: z.never(),
  responseSchema: z
    .object({
      sdkConnection: apiSdkConnectionValidator,
    })
    .strict(),
  summary: "Create a single sdk connection",
  operationId: "postSdkConnection",
  tags: ["sdk-connections"],
  method: "post" as const,
  path: "/sdk-connections",
};

export const getSdkConnectionValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: idParams,
  responseSchema: z
    .object({
      sdkConnection: apiSdkConnectionValidator,
    })
    .strict(),
  summary: "Get a single sdk connection",
  operationId: "getSdkConnection",
  tags: ["sdk-connections"],
  method: "get" as const,
  path: "/sdk-connections/:id",
  exampleRequest: { params: { id: "abc123" } },
};

export const putSdkConnectionValidator = {
  bodySchema: putSdkConnectionBody,
  querySchema: z.never(),
  paramsSchema: idParams,
  responseSchema: z
    .object({
      sdkConnection: apiSdkConnectionValidator,
    })
    .strict(),
  summary: "Update a single sdk connection",
  operationId: "putSdkConnection",
  tags: ["sdk-connections"],
  method: "put" as const,
  path: "/sdk-connections/:id",
};

export const deleteSdkConnectionValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: idParams,
  responseSchema: z
    .object({
      deletedId: z.string(),
    })
    .strict(),
  summary: "Deletes a single SDK connection",
  operationId: "deleteSdkConnection",
  tags: ["sdk-connections"],
  method: "delete" as const,
  path: "/sdk-connections/:id",
  exampleRequest: { params: { id: "abc123" } },
};

export const lookupSdkConnectionByKeyValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: z
    .object({
      key: z.string().describe("The key of the requested sdkConnection"),
    })
    .strict(),
  responseSchema: z
    .object({
      sdkConnection: apiSdkConnectionValidator,
    })
    .strict(),
  summary: "Find a single sdk connection by its key",
  operationId: "lookupSdkConnectionByKey",
  tags: ["sdk-connections"],
  method: "get" as const,
  path: "/sdk-connections/lookup/:key",
  exampleRequest: { params: { key: "abc123" } },
};
