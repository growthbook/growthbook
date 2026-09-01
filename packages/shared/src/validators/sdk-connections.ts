import { z } from "zod";
import { apiPaginationFieldsValidator, paginationQueryFields } from "./shared";
import { namedSchema } from "./openapi-helpers";
import { payloadFormatValidator, webhookMethods } from "./webhooks";

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
      includeDraftExperimentRefs: z
        .boolean()
        .optional()
        .describe(
          "When true, experiment-ref rules linked to draft experiments are included in feature definitions. Off by default.",
        ),
      includeExperimentNames: z.boolean().optional(),
      includeRedirectExperiments: z.boolean().optional(),
      includeRuleIds: z.boolean().optional(),
      includeProjectIdInMetadata: z.boolean().optional(),
      includeCustomFieldsInMetadata: z.boolean().optional(),
      allowedCustomFieldsInMetadata: z.array(z.string()).optional(),
      includeTagsInMetadata: z.boolean().optional(),
      includeExperimentScheduleInMetadata: z.boolean().optional(),
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

// ---------------------------------------------------------------------------
// Revision/approval-flow schemas
// ---------------------------------------------------------------------------

// The connection-settings portion of a revision snapshot. It is a flattened,
// secret-free projection of SDKConnectionInterface:
//   - `proxy` is flattened to `proxyEnabled` / `proxyHost` so it lines up with
//     the EditSDKConnectionParams the merge step ultimately writes.
//   - secret/system fields (`encryptionKey`, `key`, the proxy signing key,
//     `connected`, `managedBy`) are intentionally omitted.
// Strict so the adapter's snapshot whitelist can't silently drift from this.
export const sdkConnectionSettingsSnapshotValidator = z
  .object({
    id: z.string(),
    organization: z.string(),
    name: z.string(),
    eventTracker: z.string().optional(),
    languages: z.array(z.string()),
    sdkVersion: z.string().optional(),
    environment: z.string(),
    projects: z.array(z.string()),
    encryptPayload: z.boolean(),
    hashSecureAttributes: z.boolean().optional(),
    includeVisualExperiments: z.boolean().optional(),
    includeDraftExperiments: z.boolean().optional(),
    includeDraftExperimentRefs: z.boolean().optional(),
    includeExperimentNames: z.boolean().optional(),
    includeRedirectExperiments: z.boolean().optional(),
    includeRuleIds: z.boolean().optional(),
    includeProjectIdInMetadata: z.boolean().optional(),
    includeCustomFieldsInMetadata: z.boolean().optional(),
    allowedCustomFieldsInMetadata: z.array(z.string()).optional(),
    includeTagsInMetadata: z.boolean().optional(),
    includeExperimentScheduleInMetadata: z.boolean().optional(),
    remoteEvalEnabled: z.boolean().optional(),
    savedGroupReferencesEnabled: z.boolean().optional(),
    proxyEnabled: z.boolean().optional(),
    proxyHost: z.string().optional(),
    archived: z.boolean().optional(),
    // NOTE: dateCreated/dateUpdated are deliberately excluded. Proposed changes
    // target the whole `/sdkConnection` object, so conflict detection compares
    // it wholesale — and `dateUpdated` changes on every write, which would make
    // every draft look conflicted. They are not updatable fields either.
  })
  .strict();

export type SDKConnectionSettingsRevisionSnapshot = z.infer<
  typeof sdkConnectionSettingsSnapshotValidator
>;

// Webhook fields tracked in a revision snapshot. Runtime/secret fields
// (signingKey, lastSuccess, error, consecutiveFailures, managedBy, sdks,
// useSdkMode) are intentionally omitted.
export const sdkWebhookSnapshotValidator = z.object({
  id: z.string(),
  name: z.string(),
  endpoint: z.string(),
  httpMethod: z.enum(webhookMethods),
  headers: z.string().optional(),
  payloadFormat: payloadFormatValidator.optional(),
  payloadKey: z.string().optional(),
  disabled: z.boolean().optional(),
});

export type SDKWebhookRevisionSnapshot = z.infer<
  typeof sdkWebhookSnapshotValidator
>;

// Composite snapshot combining connection settings and associated webhooks.
// When a revision is published, `sdkConnection` changes apply to the
// sdkconnections collection and `sdkWebhooks` changes apply to the webhooks
// collection.
export const sdkConnectionSnapshotValidator = z.object({
  sdkConnection: sdkConnectionSettingsSnapshotValidator,
  sdkWebhooks: z.array(sdkWebhookSnapshotValidator),
});

export type SDKConnectionRevisionSnapshot = z.infer<
  typeof sdkConnectionSnapshotValidator
>;

// Single source of truth for the SDK-connection fields a revision is allowed to
// mutate when applying changes to the live connection. Derived from the
// settings snapshot schema so it cannot drift. The keys line up with
// EditSDKConnectionParams.
export const sdkConnectionUpdatableFieldsSchema =
  sdkConnectionSettingsSnapshotValidator.pick({
    name: true,
    eventTracker: true,
    languages: true,
    sdkVersion: true,
    environment: true,
    projects: true,
    encryptPayload: true,
    hashSecureAttributes: true,
    includeVisualExperiments: true,
    includeDraftExperiments: true,
    includeDraftExperimentRefs: true,
    includeExperimentNames: true,
    includeRedirectExperiments: true,
    includeRuleIds: true,
    includeProjectIdInMetadata: true,
    includeCustomFieldsInMetadata: true,
    allowedCustomFieldsInMetadata: true,
    includeTagsInMetadata: true,
    includeExperimentScheduleInMetadata: true,
    remoteEvalEnabled: true,
    savedGroupReferencesEnabled: true,
    proxyEnabled: true,
    proxyHost: true,
    archived: true,
  });

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
    includeDraftExperimentRefs: z
      .boolean()
      .optional()
      .describe(
        "When true, experiment-ref rules linked to draft experiments are included in feature definitions. Off by default.",
      ),
    includeExperimentNames: z.boolean().optional(),
    includeRedirectExperiments: z.boolean().optional(),
    includeRuleIds: z.boolean().optional(),
    includeProjectIdInMetadata: z.boolean().optional(),
    includeCustomFieldsInMetadata: z.boolean().optional(),
    allowedCustomFieldsInMetadata: z.array(z.string()).optional(),
    includeTagsInMetadata: z.boolean().optional(),
    includeExperimentScheduleInMetadata: z.boolean().optional(),
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
