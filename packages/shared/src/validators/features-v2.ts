import { z } from "zod";
import { MAX_DESCRIPTION_LENGTH } from "shared/constants";
import {
  apiPaginationFieldsValidator,
  booleanQueryField,
  paginationQueryFields,
  skipPaginationQueryField,
} from "./shared";
import { ownerInputField, optionalOwnerInputField } from "./owner-field";
import {
  apiFeatureRuleValidator,
  apiRevisionPrerequisiteV2,
  apiRevisionMetadata,
  apiFeatureHoldout,
  revisionStatusFilterSchema,
  apiRevisionRampAction,
} from "./features";
import { namedSchema } from "./openapi-helpers";

// ---- V2 scope extension ----

const apiRuleScopeExtension = z
  .object({
    allEnvironments: z
      .boolean()
      .describe(
        "When true the rule applies to all environments. When false only the environments listed in `environments` receive the rule.",
      ),
    environments: z
      .array(z.string())
      .optional()
      .describe(
        "The environment IDs this rule is active in. Populated when `allEnvironments` is false.",
      ),
    pendingRamp: z
      .enum(["create", "detach"])
      .optional()
      .describe(
        'Present on draft revisions only. "create" means a ramp schedule will be created for this rule on publish. "detach" means an existing live ramp schedule will be removed on publish. Use PUT/DELETE .../rules/{ruleId}/ramp-schedule to modify.',
      ),
  })
  .strict();

// ---- FeatureRuleV2 (schemas/FeatureRuleV2.yaml) ----

export const apiFeatureRuleV2Validator = namedSchema(
  "FeatureRuleV2",
  z.intersection(apiFeatureRuleValidator, apiRuleScopeExtension),
);
export type ApiFeatureRuleV2 = z.infer<typeof apiFeatureRuleV2Validator>;

// ---- FeatureEnvironmentV2 (schemas/FeatureEnvironmentV2.yaml) ----
// V2 environments no longer carry a per-env `rules` array — rules live on the
// feature's top-level `rules` field with per-rule scope.

export const apiFeatureEnvironmentV2Validator = namedSchema(
  "FeatureEnvironmentV2",
  z
    .object({
      enabled: z.boolean(),
      defaultValue: z.string(),
      definition: z
        .string()
        .describe(
          "A JSON stringified [FeatureDefinition](#tag/FeatureDefinition_model)",
        )
        .optional(),
    })
    .strict(),
);

export type ApiFeatureEnvironmentV2 = z.infer<
  typeof apiFeatureEnvironmentV2Validator
>;

// ---- FeatureRevisionV2 (schemas/FeatureRevisionV2.yaml) ----
// Identical to FeatureRevision except `rules` is a flat array with per-rule
// scope instead of a per-environment record.

export const apiFeatureRevisionV2Validator = namedSchema(
  "FeatureRevisionV2",
  z
    .object({
      featureId: z.string().describe("The feature this revision belongs to"),
      baseVersion: z.coerce.number().int(),
      version: z.coerce.number().int(),
      comment: z.string(),
      date: z.string().meta({ format: "date-time" }),
      status: z.string(),
      createdBy: z.string().optional(),
      publishedBy: z.string().optional(),
      defaultValue: z
        .string()
        .describe("The default value at the time this revision was created")
        .optional(),
      rules: z
        .array(apiFeatureRuleV2Validator)
        .describe(
          "Unified rules array. Each rule carries its own environment scope via `allEnvironments` / `environments`.",
        ),
      definitions: z
        .record(
          z.string(),
          z
            .string()
            .describe(
              "A JSON stringified [FeatureDefinition](#tag/FeatureDefinition_model)",
            ),
        )
        .optional(),
      environmentsEnabled: z
        .record(z.string(), z.boolean())
        .describe(
          "Per-environment enabled state captured in this revision (only present when kill-switch gating is enabled)",
        )
        .optional(),
      envPrerequisites: z
        .record(z.string(), z.array(apiRevisionPrerequisiteV2))
        .describe(
          "Per-environment prerequisites captured in this revision (only present when prerequisite gating is enabled)",
        )
        .optional(),
      prerequisites: z
        .array(apiRevisionPrerequisiteV2)
        .describe(
          "Feature-level prerequisites captured in this revision. Each entry is a boolean flag ID that must evaluate to true for this flag to be active for a given user.",
        )
        .optional(),
      metadata: apiRevisionMetadata.optional(),
      rampActions: z
        .array(apiRevisionRampAction)
        .describe(
          "Pending ramp schedule actions that will be applied when this draft is published",
        )
        .optional(),
    })
    .strict(),
);

export type ApiFeatureRevisionV2 = z.infer<
  typeof apiFeatureRevisionV2Validator
>;

// ---- FeatureV2 (schemas/FeatureV2.yaml) ----

export const apiFeatureV2Validator = namedSchema(
  "FeatureV2",
  z
    .object({
      id: z.string(),
      dateCreated: z.string().meta({ format: "date-time" }),
      dateUpdated: z.string().meta({ format: "date-time" }),
      archived: z.boolean(),
      description: z.string().max(MAX_DESCRIPTION_LENGTH),
      owner: ownerInputField,
      project: z.string(),
      valueType: z.enum(["boolean", "string", "number", "json"]),
      defaultValue: z.string(),
      tags: z.array(z.string()),
      rules: z
        .array(apiFeatureRuleV2Validator)
        .describe(
          "Unified rules array. Each rule carries its own environment scope via `allEnvironments` / `environments`.",
        ),
      environments: z
        .record(z.string(), apiFeatureEnvironmentV2Validator)
        .describe(
          "Per-environment enabled state and SDK payload. Rules are on the top-level `rules` field.",
        ),
      prerequisites: z
        .array(z.string())
        .describe("Feature IDs. Each feature must evaluate to `true`")
        .optional(),
      revision: z.object({
        version: z.coerce.number().int(),
        comment: z.string(),
        date: z.string().meta({ format: "date-time" }),
        createdBy: z.string(),
        publishedBy: z.string(),
      }),
      customFields: z.record(z.string(), z.any()).optional(),
      holdout: apiFeatureHoldout,
    })
    .strict(),
);

export type ApiFeatureV2 = z.infer<typeof apiFeatureV2Validator>;

// ---- FeatureWithRevisionsV2 ----

export const apiFeatureWithRevisionsV2Validator = namedSchema(
  "FeatureWithRevisionsV2",
  z.intersection(
    apiFeatureV2Validator,
    z.object({
      revisions: z.array(apiFeatureRevisionV2Validator).optional(),
    }),
  ),
);

export type ApiFeatureWithRevisionsV2 = z.infer<
  typeof apiFeatureWithRevisionsV2Validator
>;

// ---- Shared response schemas ----

const featureV2ResponseSchema = z
  .object({ feature: apiFeatureV2Validator })
  .strict();

// ---- Shared param schemas ----

const idParams = z
  .object({
    id: z.string().describe("The id of the requested resource"),
  })
  .strict();

// ---- V2 POST/PUT body schemas ----

// V2 POST/PUT body rule — same rule shapes as v1 input but with scope fields
// embedded alongside the rule definition. Scope defaults to allEnvironments:
// true so callers only need to supply `environments` when scoping to specific
// envs.
const v2RuleScopeInput = z.object({
  allEnvironments: z
    .boolean()
    .optional()
    .describe("When true the rule applies to all environments (default)."),
  environments: z
    .array(z.string())
    .optional()
    .describe(
      "Specific environment IDs this rule applies to. Required when allEnvironments is false.",
    ),
});

// Re-use the same per-rule shapes from v1 (force, rollout, experiment-ref,
// experiment) but extend them with scope fields. We build a flat union here
// because extending a discriminated union in Zod requires touching each
// member.

const postFeatureSavedGroupTargeting = z.object({
  matchType: z.enum(["all", "any", "none"]),
  savedGroups: z.array(z.string()),
});

const postFeaturePrerequisite = z.object({
  id: z.string().describe("Feature ID"),
  condition: z.string(),
});

const apiScheduleRule = z.object({
  timestamp: z
    .string()
    .datetime({ offset: true })
    .nullable()
    .describe('ISO 8601 date-time, e.g. "2025-06-01T00:00:00Z".'),
  enabled: z.boolean(),
});

const v2RuleForceBase = z.object({
  description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
  condition: z.string().optional(),
  savedGroupTargeting: z.array(postFeatureSavedGroupTargeting).optional(),
  prerequisites: z.array(postFeaturePrerequisite).optional(),
  scheduleRules: z.array(apiScheduleRule).optional(),
  id: z.string().optional(),
  enabled: z.boolean().optional(),
  type: z.literal("force"),
  value: z.string(),
});

const v2RuleRolloutBase = z.object({
  description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
  condition: z.string().optional(),
  savedGroupTargeting: z.array(postFeatureSavedGroupTargeting).optional(),
  prerequisites: z.array(postFeaturePrerequisite).optional(),
  scheduleRules: z.array(apiScheduleRule).optional(),
  id: z.string().optional(),
  enabled: z.boolean().optional(),
  type: z.literal("rollout"),
  value: z.string(),
  coverage: z.number(),
  hashAttribute: z.string(),
  hashVersion: z.union([z.literal(1), z.literal(2)]).optional(),
});

const v2RuleExperimentRefBase = z.object({
  description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
  id: z.string().optional(),
  enabled: z.boolean().optional(),
  type: z.literal("experiment-ref"),
  condition: z.string().optional(),
  savedGroupTargeting: z.array(postFeatureSavedGroupTargeting).optional(),
  prerequisites: z.array(postFeaturePrerequisite).optional(),
  scheduleRules: z.array(apiScheduleRule).optional(),
  variations: z.array(z.object({ value: z.string(), variationId: z.string() })),
  experimentId: z.string(),
});

// Preserve-only shape for safe-rollout rules. The bulk POST/PUT v2 endpoints
// can't create new safe-rollouts (that requires SafeRollout entity creation,
// datasource validation, premium checks, and compensation on failure — see
// `POST /v2/features/:id/revisions/:version/rules`). But round-tripping
// existing safe-rollout rules through GET → modify → PUT must work, so the
// validator accepts the rule body with a required `safeRolloutId` pointing
// at an existing safe-rollout on the same feature. The handler rejects any
// safeRolloutId that isn't already on the feature.
const v2RuleSafeRolloutBase = z.object({
  description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
  id: z.string().optional(),
  enabled: z.boolean().optional(),
  type: z.literal("safe-rollout"),
  condition: z.string().optional(),
  savedGroupTargeting: z.array(postFeatureSavedGroupTargeting).optional(),
  prerequisites: z.array(postFeaturePrerequisite).optional(),
  scheduleRules: z.array(apiScheduleRule).optional(),
  controlValue: z.string(),
  variationValue: z.string(),
  hashAttribute: z.string(),
  trackingKey: z.string().optional(),
  seed: z.string().optional(),
  safeRolloutId: z
    .string()
    .describe(
      "ID of an existing SafeRollout on this feature. Bulk POST/PUT cannot create new safe-rollouts; use POST /v2/features/:id/revisions/:version/rules to create one.",
    ),
  status: z.enum(["running", "released", "rolled-back", "stopped"]).optional(),
});

export const postFeatureRuleV2 = z.union([
  v2RuleForceBase.merge(v2RuleScopeInput),
  v2RuleRolloutBase.merge(v2RuleScopeInput),
  v2RuleExperimentRefBase.merge(v2RuleScopeInput),
  v2RuleSafeRolloutBase.merge(v2RuleScopeInput),
]);

const postFeatureEnvironmentV2 = z.object({
  enabled: z.boolean().optional(),
});

// ---- V2 PostFeaturePayload ----
export const postFeatureBodyV2 = z
  .object({
    id: z
      .string()
      .min(1)
      .describe(
        "A unique key name for the feature. Feature keys can only include letters, numbers, hyphens, and underscores.",
      ),
    archived: z.boolean().optional(),
    description: z
      .string()
      .max(MAX_DESCRIPTION_LENGTH)
      .describe("Description of the feature")
      .optional(),
    owner: optionalOwnerInputField,
    project: z.string().describe("An associated project ID").optional(),
    valueType: z
      .enum(["boolean", "string", "number", "json"])
      .describe("The data type of the feature payload. Boolean by default."),
    defaultValue: z
      .string()
      .describe(
        "Default value when feature is enabled. Type must match `valueType`.",
      ),
    tags: z.array(z.string()).describe("List of associated tags").optional(),
    rules: z
      .array(postFeatureRuleV2)
      .describe(
        "Feature rules. Each rule carries its own environment scope via `allEnvironments` / `environments`.",
      )
      .optional(),
    environments: z
      .record(z.string(), postFeatureEnvironmentV2)
      .describe(
        "Per-environment enabled state. V2 rules are specified on the top-level `rules` field.",
      )
      .optional(),
    prerequisites: z
      .array(z.string())
      .describe("Feature IDs. Each feature must evaluate to `true`")
      .optional(),
    jsonSchema: z
      .string()
      .describe(
        "Use JSON schema to validate the payload of a JSON-type feature value (enterprise only).",
      )
      .optional(),
    customFields: z.record(z.string(), z.string()).optional(),
  })
  .strict();

// ---- V2 UpdateFeaturePayload ----
export const updateFeatureBodyV2 = z
  .object({
    description: z
      .string()
      .max(MAX_DESCRIPTION_LENGTH)
      .describe("Description of the feature")
      .optional(),
    archived: z.boolean().optional(),
    project: z.string().describe("An associated project ID").optional(),
    owner: ownerInputField.optional(),
    defaultValue: z.string().optional(),
    tags: z
      .array(z.string())
      .describe(
        "List of associated tags. Will override tags completely with submitted list",
      )
      .optional(),
    rules: z
      .array(postFeatureRuleV2)
      .describe(
        "Replaces all feature rules atomically. Behavior differs from v1: v1 PUT applies per-environment patches, v2 PUT swaps the entire `rules` array in one revision. To preserve existing rules during a partial edit, GET the feature first, mutate the returned `rules` array, and PUT the full array back. Safe-rollout rules round-trip via their `safeRolloutId` (creation requires `POST /v2/features/:id/revisions/:version/rules`).",
      )
      .optional(),
    environments: z
      .record(z.string(), postFeatureEnvironmentV2)
      .describe(
        "Per-environment enabled state. V2 rules are specified on the top-level `rules` field.",
      )
      .optional(),
    prerequisites: z
      .array(z.string())
      .describe("Feature IDs. Each feature must evaluate to `true`")
      .optional(),
    jsonSchema: z
      .string()
      .describe(
        "Use JSON schema to validate the payload of a JSON-type feature value (enterprise only).",
      )
      .optional(),
    customFields: z.record(z.string(), z.string()).optional(),
    holdout: z
      .object({
        id: z.string().describe("Holdout ID"),
        value: z
          .string()
          .describe(
            "The feature value assigned to users in the holdout treatment group",
          ),
      })
      .nullable()
      .describe(
        "Holdout to assign this feature to. Pass `null` to remove the feature from its current holdout. Omit the field entirely to leave the holdout unchanged.\n",
      )
      .optional(),
  })
  .strict();

// ---- Route validators ----

export const listFeaturesV2Validator = {
  bodySchema: z.never(),
  querySchema: z
    .object({
      ...paginationQueryFields,
      projectId: z.string().describe("Filter by project id").optional(),
      clientKey: z
        .string()
        .describe("Filter by a SDK connection's client key")
        .optional(),
      archived: booleanQueryField.describe(
        "Whether to include archived features. Defaults to `false` (non-archived only). Pass `true` to include archived features alongside non-archived ones.",
      ),
      ...skipPaginationQueryField,
    })
    .strict(),
  paramsSchema: z.never(),
  responseSchema: z.intersection(
    z.object({
      features: z.array(apiFeatureV2Validator),
    }),
    apiPaginationFieldsValidator,
  ),
  summary: "Get all features",
  description:
    "Returns features with pagination. Rules are returned as a unified top-level array with per-rule environment scope.\n",
  operationId: "listFeaturesV2",
  tags: ["features-v2"],
  method: "get" as const,
  path: "/features",
  version: "v2" as const,
};

export const postFeatureV2Validator = {
  bodySchema: postFeatureBodyV2,
  querySchema: z.never(),
  paramsSchema: z.never(),
  responseSchema: featureV2ResponseSchema,
  summary: "Create a single feature",
  description:
    "Creates a new feature. Rules are supplied as a top-level `rules` array; each rule includes `allEnvironments` / `environments` scope fields.",
  operationId: "postFeatureV2",
  tags: ["features-v2"],
  method: "post" as const,
  path: "/features",
  version: "v2" as const,
};

export const getFeatureV2Validator = {
  bodySchema: z.never(),
  querySchema: z
    .object({
      withRevisions: z
        .enum(["all", "drafts", "published", "none"])
        .describe(
          "Also return feature revisions (all, draft, or published statuses)",
        )
        .optional(),
    })
    .strict(),
  paramsSchema: idParams,
  responseSchema: z
    .object({ feature: apiFeatureWithRevisionsV2Validator })
    .strict(),
  summary: "Get a single feature",
  operationId: "getFeatureV2",
  tags: ["features-v2"],
  method: "get" as const,
  path: "/features/:id",
  version: "v2" as const,
  exampleRequest: { params: { id: "abc123" } },
};

export const updateFeatureV2Validator = {
  bodySchema: updateFeatureBodyV2,
  querySchema: z.never(),
  paramsSchema: idParams,
  responseSchema: featureV2ResponseSchema,
  summary: "Partially update a feature",
  description:
    "Updates any combination of a feature's metadata, default value, environment state, and rules. Other top-level fields are patch-merged: omit a field to leave it unchanged. The `rules` field, when supplied, replaces the entire `rules` array atomically in a single revision (v1 PUT applied per-environment patches; v2 swaps the full flat array). To preserve existing rules during a partial edit, GET the feature first, mutate the returned `rules` array, and PUT the full array back. Safe-rollout rules round-trip via their `safeRolloutId`; use `POST /v2/features/:id/revisions/:version/rules` to create new ones. Returns 403 if approval rules are enabled for an affected environment and the bypass setting is off.",
  operationId: "updateFeatureV2",
  tags: ["features-v2"],
  method: "post" as const,
  path: "/features/:id",
  version: "v2" as const,
};

export const deleteFeatureV2Validator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: idParams,
  responseSchema: z
    .object({
      deletedId: z
        .string()
        .describe("The ID of the deleted feature")
        .meta({ example: "feature-123" }),
    })
    .strict(),
  summary: "Deletes a single feature",
  description:
    'Permanently deletes a feature and all of its revisions.\n\nArchived features can be deleted freely. Deleting a live (non-archived) feature returns 403 unless the org setting "REST API always bypasses approval requirements" is enabled.\n',
  operationId: "deleteFeatureV2",
  tags: ["features-v2"],
  method: "delete" as const,
  path: "/features/:id",
  version: "v2" as const,
  exampleRequest: { params: { id: "abc123" } },
};

export const toggleFeatureV2Validator = {
  bodySchema: z
    .object({
      reason: z.string().optional(),
      environments: z.record(
        z.string(),
        z.union([
          z.literal(true),
          z.literal(false),
          z.literal("true"),
          z.literal("false"),
          z.literal("1"),
          z.literal("0"),
          z.literal(1),
          z.literal(0),
          z.literal(""),
        ]),
      ),
    })
    .strict(),
  querySchema: z.never(),
  paramsSchema: idParams,
  responseSchema: featureV2ResponseSchema,
  summary: "Toggle a feature in one or more environments",
  description:
    "Enables or disables a feature in one or more environments simultaneously. Accepts a map of environment name → boolean.",
  operationId: "toggleFeatureV2",
  tags: ["features-v2"],
  method: "post" as const,
  path: "/features/:id/toggle",
  version: "v2" as const,
};

export const revertFeatureV2Validator = {
  bodySchema: z
    .object({
      revision: z.number(),
      comment: z.string().optional(),
    })
    .strict(),
  querySchema: z.never(),
  paramsSchema: idParams,
  responseSchema: featureV2ResponseSchema,
  summary: "Revert a feature to a specific revision",
  operationId: "revertFeatureV2",
  tags: ["features-v2"],
  method: "post" as const,
  path: "/features/:id/revert",
  version: "v2" as const,
};

export const getFeatureRevisionsV2Validator = {
  bodySchema: z.never(),
  querySchema: z
    .object({
      ...paginationQueryFields,
      ...skipPaginationQueryField,
      status: revisionStatusFilterSchema,
      author: z.string().optional(),
      mine: booleanQueryField.describe(
        "If true, return only revisions authored by or contributed to by the calling user. Requires a user-scoped API key. Mutually exclusive with `author`.",
      ),
    })
    .strict(),
  paramsSchema: idParams,
  responseSchema: z
    .object({
      revisions: z.array(apiFeatureRevisionV2Validator),
    })
    .extend(apiPaginationFieldsValidator.shape),
  summary: "List revisions for a feature",
  description:
    "Returns a paginated list of revisions for this feature, sorted newest-first. Revision `rules` is a flat array with per-rule scope.",
  operationId: "getFeatureRevisionsV2",
  tags: ["feature-revisions-v2"],
  method: "get" as const,
  path: "/features/:id/revisions",
  version: "v2" as const,
};

export const getFeatureKeysV2Validator = {
  bodySchema: z.never(),
  querySchema: z
    .object({
      projectId: z.string().describe("Filter by project id").optional(),
    })
    .strict(),
  paramsSchema: z.never(),
  responseSchema: z.array(z.string()),
  summary: "Get list of feature keys",
  operationId: "getFeatureKeysV2",
  tags: ["features-v2"],
  method: "get" as const,
  path: "/feature-keys",
  version: "v2" as const,
};

export const getFeatureStaleV2Validator = {
  bodySchema: z.never(),
  querySchema: z
    .object({
      ids: z
        .string()
        .describe(
          "Comma-separated list of feature IDs (URL-encoded if needed). Example: `my_feature,another_feature`\n",
        ),
    })
    .strict(),
  paramsSchema: z.never(),
  responseSchema: z
    .object({
      features: z
        .record(
          z.string(),
          z.object({
            featureId: z.string(),
            isStale: z.boolean(),
            staleReason: z
              .enum([
                "never-stale",
                "recently-updated",
                "active-draft",
                "has-dependents",
                "no-rules",
                "rules-one-sided",
                "abandoned-draft",
                "toggled-off",
                "active-experiment",
                "has-rules",
              ])
              .nullable(),
            neverStale: z.boolean(),
            staleByEnv: z
              .record(
                z.string(),
                z.object({
                  isStale: z.boolean(),
                  reason: z
                    .enum([
                      "no-rules",
                      "rules-one-sided",
                      "abandoned-draft",
                      "toggled-off",
                      "active-experiment",
                      "has-rules",
                      "recently-updated",
                      "active-draft",
                      "has-dependents",
                    ])
                    .nullable(),
                  evaluatesTo: z.string().optional(),
                }),
              )
              .optional(),
          }),
        )
        .describe(
          "Map of feature ID to stale status. Only requested features that were found and readable are included.",
        ),
    })
    .strict(),
  summary: "Get stale status for one or more features",
  operationId: "getFeatureStaleV2",
  tags: ["features-v2"],
  method: "get" as const,
  path: "/stale-features",
  version: "v2" as const,
};
