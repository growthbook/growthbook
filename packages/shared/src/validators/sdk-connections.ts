import { z } from "zod";
import {
  apiPaginationFieldsValidator,
  paginationQueryFields,
  publishBypassedGatesField,
} from "./shared";
import { namedSchema } from "./openapi-helpers";
import {
  payloadFormatValidator,
  webhookMethods,
  webhookTimeoutSecondsValidator,
} from "./webhooks";

/**
 * The three ways Saved Groups can be written into an SDK payload.
 *
 * - `inline`: put each group's values straight into the conditions, using
 *   `$in` and `$nin`. The payload has no `savedGroups` field. For SDKs that
 *   cannot look up a reference at all.
 * - `referencesV1`: ID list groups become `$inGroup` or `$notInGroup`, looked
 *   up in a map of plain value arrays. Condition groups have no reference form
 *   here, so their conditions still go inline.
 * - `referencesV2`: every group becomes a `$savedGroup` reference, looked up in
 *   a map of typed entries.
 */
export const savedGroupFormatValidator = z.enum([
  "inline",
  "referencesV1",
  "referencesV2",
]);
export type SavedGroupFormat = z.infer<typeof savedGroupFormatValidator>;

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
      savedGroupReferencesEnabled: z
        .boolean()
        .optional()
        .describe("Deprecated. Use `savedGroupFormat`."),
      savedGroupFormat: savedGroupFormatValidator
        .optional()
        .describe(
          "How Saved Groups are written into this connection's payload. `referencesV2` needs an SDK version that supports it; the payload steps down to `referencesV1` if not.",
        ),
      includeReferencedPrerequisites: z.boolean().optional(),
      archived: z
        .boolean()
        .optional()
        .describe(
          "An archived connection serves no payload. A connection must be archived before it can be deleted.",
        ),
    })
    .strict(),
);

export type ApiSdkConnection = z.infer<typeof apiSdkConnectionValidator>;

// Secret-free projection of SDKConnectionInterface, with `proxy` flattened to
// line up with EditSDKConnectionParams.
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
    savedGroupFormat: savedGroupFormatValidator.optional(),
    includeReferencedPrerequisites: z.boolean().optional(),
    proxyEnabled: z.boolean().optional(),
    proxyHost: z.string().optional(),
    // No dates: the object is compared wholesale for conflicts, and
    // `dateUpdated` changes on every write.
    archived: z.boolean().optional(),
  })
  .strict();

export type SDKConnectionSettingsRevisionSnapshot = z.infer<
  typeof sdkConnectionSettingsSnapshotValidator
>;

// Runtime and secret webhook fields are omitted.
export const sdkWebhookSnapshotValidator = z.object({
  id: z.string(),
  name: z.string(),
  endpoint: z.string(),
  httpMethod: z.enum(webhookMethods),
  headers: z.string().optional(),
  payloadFormat: payloadFormatValidator.optional(),
  payloadKey: z.string().optional(),
  disabled: z.boolean().optional(),
  timeoutSeconds: webhookTimeoutSecondsValidator.optional(),
});

export type SDKWebhookRevisionSnapshot = z.infer<
  typeof sdkWebhookSnapshotValidator
>;

// A null timeout means "use the default", same as an absent one; dropping it
// keeps the two from diffing as a change.
export function parseSdkWebhookSnapshot(
  value: unknown,
): SDKWebhookRevisionSnapshot {
  const { timeoutSeconds, ...rest } = sdkWebhookSnapshotValidator.parse(value);
  return (timeoutSeconds ?? null) === null ? rest : { ...rest, timeoutSeconds };
}

export const sdkConnectionSnapshotValidator = z.object({
  sdkConnection: sdkConnectionSettingsSnapshotValidator,
  sdkWebhooks: z.array(sdkWebhookSnapshotValidator),
});

export type SDKConnectionRevisionSnapshot = z.infer<
  typeof sdkConnectionSnapshotValidator
>;

// The fields a revision may write to the live connection.
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
    savedGroupFormat: true,
    includeReferencedPrerequisites: true,
    proxyEnabled: true,
    proxyHost: true,
    archived: true,
  });

// Corresponds to payload-schemas/PostSdkConnectionPayload.yaml
const postSdkConnectionBody = z
  .object({
    name: z
      .string()
      .describe(
        "Short display name, usually app and platform (e.g. `Web app`).",
      ),
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
    savedGroupReferencesEnabled: z
      .boolean()
      .optional()
      .describe("Deprecated. Use `savedGroupFormat`."),
    savedGroupFormat: savedGroupFormatValidator.optional(),
    includeReferencedPrerequisites: z
      .boolean()
      .optional()
      .describe(
        "Carry prerequisite Feature Flags into this payload even when they target other Projects. Defaults to true for new connections.",
      ),
  })
  .strict();

// Corresponds to payload-schemas/PutSdkConnectionPayload.yaml
const putSdkConnectionBody = postSdkConnectionBody
  .partial()
  .extend({
    archived: z
      .boolean()
      .optional()
      .describe(
        "Archive (true) or restore (false) the connection. Archiving takes the same authority as deleting it; restoring takes publish authority. A connection must be archived before it can be deleted.",
      ),
  })
  .strict();

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
  confirmation: ["sdkConnection.create"] as const,
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
      bypassedGates: publishBypassedGatesField,
    })
    .strict(),
  summary: "Update a single sdk connection",
  description:
    "Applies the change immediately and records it as a published revision, so it appears in the connection's history. When the organization requires approvals for this connection's projects and environment, the request is refused unless the API key's role holds the `bypassApprovalSDKConnections` permission or the organization has enabled 'REST API always bypasses approval requirements'; open a draft from the SDK connection page instead. Set `archived` to archive or restore the connection.",
  confirmation: ["sdkConnection.edit"] as const,
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
  description:
    "The connection must already be archived (`PUT /sdk-connections/{id}` with `archived: true`), so that taking an SDK offline is a reviewable step when the organization requires approvals. Deleting an archived connection needs no approval.",
  confirmation: ["sdkConnection.delete"] as const,
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
