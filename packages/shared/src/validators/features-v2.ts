import { z } from "zod";
import { MAX_DESCRIPTION_LENGTH } from "shared/constants";
import {
  apiPaginationFieldsValidator,
  booleanQueryField,
  paginationQueryFields,
  publishOverrideBodyFields,
  schemaValidationQueryFields,
  skipPaginationQueryField,
} from "./shared";
import {
  ownerInputField,
  requiredUnlessPatOwnerInputField,
} from "./owner-field";
import {
  apiEventUserValidator,
  apiFeatureBaseRuleValidator,
  apiFeatureForceRuleValidator,
  apiFeatureRolloutRuleValidator,
  apiFeatureExperimentRuleValidator,
  apiFeatureSafeRolloutRuleValidator,
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

// Config-backing surfaced as a discrete field instead of the internal
// `$extends: ["@config:…"]` directive. When set, the accompanying value is a
// JSON override patch merged on top of the config's resolved JSON (the patch's
// own keys win). `@const:` extends are never config-backing and pass through
// untouched inside the raw value. Force/rollout carry a single rule-level
// config; experiment-ref carries one per variation (each variation value can
// back a different config in the family).
const apiRuleConfigField = z
  .string()
  .nullable()
  .describe(
    "Key of the config backing this value, or null when the value is not config-backed. The config supplies the base JSON (and its schema); the value is an override patch merged on top.",
  )
  .optional();

// Feature-level "Config mode": the config a JSON flag is backed by. The config
// supplies the base JSON + schema; `defaultValue` and rule values are override
// patches on top. null/omitted for a plain flag. `@config:` never appears raw in
// any value string — this field is the only way to set it (`@const:` refs still
// pass through inside values).
const apiBaseConfigField = z
  .string()
  .nullable()
  .describe(
    'Key of the config backing this flag ("Config mode"). Requires `valueType: "json"` and a live config. The config supplies the base JSON and schema; `defaultValue` and rule values are override patches on top. null or omitted for a plain flag.',
  )
  .optional();

// Same field on update, where the backing config is fixed at creation: an
// update that changes it is rejected, so callers may only resend the current
// value or omit it.
const apiBaseConfigUpdateField = z
  .string()
  .nullable()
  .describe(
    "The config backing this flag, fixed at creation. Cannot be changed by an update — resend the current value or omit it; a different value is rejected.",
  )
  .optional();

// Selects which config the DEFAULT value resolves to: a config within
// `baseConfig`'s family, else `baseConfig` itself. The default is exactly that
// config with no overrides of its own (unlike rules, which patch their config).
const apiDefaultValueConfigField = z
  .string()
  .nullable()
  .describe(
    "Optional. A config within `baseConfig`'s family that the default value resolves to instead of `baseConfig` itself. null or omitted means the default is `baseConfig`. The default is exactly this config and carries no overrides of its own.",
  )
  .optional();

const apiFeatureForceRuleV2 = z.intersection(
  apiFeatureForceRuleValidator,
  z.object({ config: apiRuleConfigField }),
);

const apiFeatureRolloutRuleV2 = z.intersection(
  apiFeatureRolloutRuleValidator,
  z.object({ config: apiRuleConfigField }),
);

// Rebuilt (rather than intersected) so each variation can carry its own
// `config`; intersecting the v1 experiment-ref shape would leave the v1
// variation array (without config) in place.
const apiFeatureExperimentRefRuleV2 = z.intersection(
  apiFeatureBaseRuleValidator,
  z.object({
    type: z.literal("experiment-ref"),
    variations: z.array(
      z.object({
        value: z.string(),
        variationId: z.string(),
        config: apiRuleConfigField,
      }),
    ),
    experimentId: z.string(),
    sparse: z
      .boolean()
      .describe(
        "JSON features only. When true, each variation `value` is a partial object merged onto the feature's default value instead of replacing it.",
      )
      .optional(),
  }),
);

// Rebuilt (like experiment-ref above) so each variation can carry its own
// `config`.
const apiFeatureContextualBanditRefRuleV2 = z.intersection(
  apiFeatureBaseRuleValidator,
  z.object({
    type: z.literal("contextual-bandit-ref"),
    variations: z.array(
      z.object({
        value: z.string(),
        variationId: z.string(),
        config: apiRuleConfigField,
      }),
    ),
    contextualBanditId: z.string(),
  }),
);

export const apiFeatureRuleV2Validator = namedSchema(
  "FeatureRuleV2",
  z.intersection(
    z.union([
      apiFeatureForceRuleV2,
      apiFeatureRolloutRuleV2,
      apiFeatureExperimentRuleValidator,
      apiFeatureExperimentRefRuleV2,
      apiFeatureContextualBanditRefRuleV2,
      apiFeatureSafeRolloutRuleValidator,
    ]),
    apiRuleScopeExtension,
  ),
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
      id: z
        .string()
        .describe(
          "Stable revision id. Newer revisions carry opaque ids; older ones a derived `frev_<version>_<featureId>` form. Both work wherever revision ids are accepted.",
        ),
      featureId: z.string().describe("The feature this revision belongs to"),
      baseVersion: z.coerce.number().int(),
      version: z.coerce.number().int(),
      comment: z.string(),
      date: z.string().meta({ format: "date-time" }),
      status: z.string(),
      createdBy: apiEventUserValidator.optional(),
      publishedBy: apiEventUserValidator.optional(),
      defaultValue: z
        .string()
        .describe(
          "The default value at the time this revision was created. When the feature is in Config mode, this is the JSON override patch merged on top of the config (its own keys win); otherwise it is the full value.",
        )
        .optional(),
      defaultValueConfig: apiDefaultValueConfigField,
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
      autoPublishOnApproval: z
        .boolean()
        .describe(
          "When true, the revision is armed to publish automatically once governance allows (immediately on approval, or on `scheduledPublishAt` if set).",
        )
        .optional(),
      scheduledPublishAt: z
        .union([z.string().meta({ format: "date-time" }), z.null()])
        .describe(
          "Target date for a deferred (scheduled) publish. Null/absent means publish as soon as approved.",
        )
        .optional(),
      scheduledPublishLockEdits: z
        .boolean()
        .describe(
          "When true, content edits to this draft are frozen while the schedule is pending (rebasing is still allowed).",
        )
        .optional(),
      scheduledPublishLockOthers: z
        .boolean()
        .describe(
          "When true, publishing other drafts of this feature is blocked while the schedule is pending.",
        )
        .optional(),
      scheduledPublishBypassApproval: z
        .boolean()
        .describe(
          "When true, this schedule was armed by an admin via the bypass-approval override. It cannot be edited inline (only canceled and re-armed) and anyone with publish authority may cancel it.",
        )
        .optional(),
      scheduledPublishLastError: z
        .string()
        .describe(
          "Set when a due scheduled publish keeps failing (e.g. still awaiting approval, merge conflict). Indicates the schedule is stuck and retrying.",
        )
        .optional(),
      reviews: z
        .array(
          z
            .object({
              userId: z
                .string()
                .describe(
                  "Stable reviewer identifier: the user ID for dashboard users, or the API key ID for service accounts",
                ),
              user: apiEventUserValidator.optional(),
              status: z.enum([
                "approved",
                "changes-requested",
                "approved-stale",
                "changes-requested-stale",
              ]),
              timestamp: z.string().meta({ format: "date-time" }),
            })
            .strict(),
        )
        .describe(
          "Reviewer verdicts for the current review cycle (one entry per reviewer). Verdicts flip to their -stale variants when draft content changes after submission; the list is cleared when a new review cycle starts. Absent on revisions that predate this field.",
        )
        .optional(),
    })
    .strict(),
);

export type ApiFeatureRevisionV2 = z.infer<
  typeof apiFeatureRevisionV2Validator
>;

// ---- FeatureV2 (schemas/FeatureV2.yaml) ----

// Slim summary of the current published revision returned inline on Feature
// responses. Named explicitly so SDK code generators don't auto-name it
// `FeatureRevision` (which would collide with FeatureRevisionV2 after
// V2-suffix stripping).
export const apiFeatureRevisionSummaryValidator = namedSchema(
  "FeatureRevisionSummary",
  z
    .object({
      id: z
        .string()
        .describe("Stable id of the feature's live revision.")
        .optional(),
      version: z.coerce.number().int(),
      comment: z.string(),
      date: z.string().meta({ format: "date-time" }),
      createdBy: apiEventUserValidator.optional(),
      publishedBy: apiEventUserValidator.optional(),
    })
    .strict(),
);

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
      baseConfig: apiBaseConfigField,
      defaultValueConfig: apiDefaultValueConfigField,
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
      revision: apiFeatureRevisionSummaryValidator,
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

const v2SparseRuleField = z
  .boolean()
  .describe(
    "JSON features only. When true, the rule value is a partial object merged onto the feature's default value instead of replacing it.",
  )
  .optional();

// When set on a write, `value` is treated as a JSON override patch and stored
// as `$extends: ["@config:<config>"]` + the patch under the hood. null/omitted
// stores `value` verbatim (a plain value, or `@const:`-extended JSON).
const v2RuleConfigInput = z
  .string()
  .nullable()
  .optional()
  .describe(
    "Key of a config to back this value. When set, `value` is a JSON override patch merged on top of the config; omit or null for a plain value.",
  );

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
  config: v2RuleConfigInput,
  sparse: v2SparseRuleField,
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
  config: v2RuleConfigInput,
  sparse: v2SparseRuleField,
  coverage: z.number(),
  hashAttribute: z.string(),
  seed: z
    .string()
    .describe("Optional seed for the hash function; defaults to the feature id")
    .optional(),
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
  variations: z.array(
    z.object({
      value: z.string(),
      variationId: z.string(),
      config: v2RuleConfigInput,
    }),
  ),
  experimentId: z.string(),
  sparse: v2SparseRuleField,
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
    owner: requiredUnlessPatOwnerInputField,
    project: z.string().describe("An associated project ID").optional(),
    valueType: z
      .enum(["boolean", "string", "number", "json"])
      .describe("The data type of the feature payload. Boolean by default."),
    defaultValue: z
      .string()
      .describe(
        'Default value when feature is enabled. Type must match `valueType`. In Config mode (`baseConfig` set) the default must be exactly a config with no overrides: send `"{}"` to use `baseConfig`, or set `defaultValueConfig` to point at a descendant.',
      ),
    baseConfig: apiBaseConfigField,
    defaultValueConfig: apiDefaultValueConfigField,
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
    ...publishOverrideBodyFields,
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
    baseConfig: apiBaseConfigUpdateField,
    defaultValueConfig: apiDefaultValueConfigField,
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
    ...publishOverrideBodyFields,
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
  querySchema: z.object({ ...schemaValidationQueryFields }).strict(),
  paramsSchema: z.never(),
  responseSchema: featureV2ResponseSchema,
  summary: "Create a single feature",
  description:
    "Creates a new feature. Rules are supplied as a top-level `rules` array; each rule includes `allEnvironments` / `environments` scope fields.\n\n" +
    "### Config-backed features (Config mode)\n\n" +
    'A JSON feature can be backed by a shared **config** — the config supplies the base JSON value and schema, and the feature\'s *rule* values become override *patches* merged on top (nested objects deep-merge; arrays and scalars replace). The default value is exactly a config with no overrides (see below). Config backing is set exclusively through dedicated fields — never a raw `$extends: ["@config:…"]` inside a value string (that is rejected). `@const:` references inside values still work.\n\n' +
    '- **Top-level (`baseConfig`):** set `valueType: "json"` and `baseConfig: "<configKey>"` to put the flag in Config mode. The config must be live. This is the family root and the base the default value patches.\n' +
    "- **Default value:** unlike rules, the default is exactly a config with no overrides of its own — send `defaultValue: \"{}\"` to use `baseConfig`. To resolve the default to a *descendant* of `baseConfig` instead, set `defaultValueConfig` to that descendant's key (it must be within `baseConfig`'s family); omit/null to use `baseConfig` directly.\n" +
    "- **Rules & experiment variations:** each carries its own `config` field naming the family config that value patches (omit/null to patch the base). `value` is the override patch.\n\n" +
    "Example:\n\n" +
    "```json\n" +
    "{\n" +
    '  "id": "checkout-config",\n' +
    '  "valueType": "json",\n' +
    '  "baseConfig": "purchase-flow",\n' +
    '  "defaultValue": "{}",\n' +
    '  "rules": [\n' +
    '    { "type": "force", "config": "purchase-flow-vip", "value": "{\\"maxItems\\": 20}", "allEnvironments": true }\n' +
    "  ]\n" +
    "}\n" +
    "```",
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
  querySchema: z.object({ ...schemaValidationQueryFields }).strict(),
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
      ...publishOverrideBodyFields,
    })
    .strict(),
  querySchema: z.never(),
  paramsSchema: idParams,
  responseSchema: featureV2ResponseSchema,
  summary: "Revert a feature to a specific revision",
  description:
    'Creates a new revision whose rules and values match a previously-published revision, then immediately publishes it, leaving a clear audit trail of the revert in the revision history.\n\nReturns 403 if the API key lacks permission, or if approval rules are enabled for an affected environment and neither the "REST API always bypasses approval requirements" nor the "Allow reverts without approval" org setting is enabled.\n\nReturns 422 with a list of `warnings` if the restored values no longer validate against the feature\'s current value type or JSON schema (e.g. reverting to a config the current schema can no longer read). Re-submit with `"ignoreWarnings": true` in the request body to revert anyway.\n',
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
