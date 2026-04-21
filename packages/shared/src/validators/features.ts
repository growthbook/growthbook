import { z } from "zod";
import { statsEngines } from "shared/constants";
import { eventUser } from "./event-user";
import {
  featurePrerequisite,
  namespaceValue,
  savedGroupTargeting,
  paginationQueryFields,
  skipPaginationQueryField,
  apiPaginationFieldsValidator,
} from "./shared";
import { safeRolloutStatusArray } from "./safe-rollout";
import { ownerField, ownerInputField } from "./owner-field";
import {
  featureRulePatch,
  rampTrigger,
  rampStep,
  rampStepAction,
  rampEndTrigger,
} from "./ramp-schedule";

import { namedSchema } from "./openapi-helpers";

export const simpleSchemaFieldValidator = z.object({
  key: z.string().max(64),
  type: z.enum(["integer", "float", "string", "boolean"]),
  required: z.boolean(),
  default: z.string().max(256),
  description: z.string().max(256),
  enum: z.array(z.string().max(256)).max(256),
  min: z.number(),
  max: z.number(),
});

export const simpleSchemaValidator = z.object({
  type: z.enum(["object", "object[]", "primitive", "primitive[]"]),
  fields: z.array(simpleSchemaFieldValidator),
});

export const featureValueType = [
  "boolean",
  "string",
  "number",
  "json",
] as const;

export type FeatureValueType = (typeof featureValueType)[number];

const scheduleRule = z
  .object({
    timestamp: z.union([z.string(), z.null()]),
    enabled: z.boolean(),
  })
  .strict();

export type ScheduleRule = z.infer<typeof scheduleRule>;

export const baseRule = z
  .object({
    description: z.string(),
    condition: z.string().optional(),
    id: z.string(),
    enabled: z.boolean().optional(),
    scheduleRules: z.array(scheduleRule).optional(),
    savedGroups: z.array(savedGroupTargeting).optional(),
    prerequisites: z.array(featurePrerequisite).optional(),
    // UI hint: which scheduling mode the user chose. "schedule" = 0-step start/end
    // date rule; "ramp" = multi-step ramp-up. Absent or "none" = no schedule.
    scheduleType: z.enum(["none", "schedule", "ramp"]).optional(),
  })
  .strict();

export const forceRule = baseRule
  .extend({
    type: z.literal("force"),
    value: z.string(),
  })
  .strict();

export type ForceRule = z.infer<typeof forceRule>;

export const rolloutRule = baseRule
  .extend({
    type: z.literal("rollout"),
    value: z.string(),
    coverage: z.number(),
    hashAttribute: z.string(),
    seed: z.string().optional(),
  })
  .strict();

export type RolloutRule = z.infer<typeof rolloutRule>;

const experimentValue = z
  .object({
    value: z.string(),
    weight: z.number(),
    name: z.string().optional(),
  })
  .strict();

export type ExperimentValue = z.infer<typeof experimentValue>;

const experimentType = ["standard", "multi-armed-bandit"] as const;
const banditStageType = ["explore", "exploit", "paused"] as const;

const experimentRule = baseRule
  .extend({
    type: z.literal("experiment"), // refers to RuleType, not experiment.type
    experimentType: z.enum(experimentType).optional(),
    hypothesis: z.string().optional(),
    trackingKey: z.string(),
    hashAttribute: z.string(),
    fallbackAttribute: z.string().optional(),
    hashVersion: z.number().optional(),
    disableStickyBucketing: z.boolean().optional(),
    bucketVersion: z.number().optional(),
    minBucketVersion: z.number().optional(),
    namespace: namespaceValue.optional(),
    coverage: z.number().optional(),
    datasource: z.string().optional(),
    exposureQueryId: z.string().optional(),
    goalMetrics: z.array(z.string()).optional(),
    secondaryMetrics: z.array(z.string()).optional(),
    guardrailMetrics: z.array(z.string()).optional(),
    activationMetric: z.string().optional(),
    segment: z.string().optional(),
    skipPartialData: z.boolean().optional(),
    values: z.array(experimentValue),
    regressionAdjustmentEnabled: z.boolean().optional(),
    sequentialTestingEnabled: z.boolean().optional(),
    sequentialTestingTuningParameter: z.number().optional(),
    statsEngine: z.enum(statsEngines).optional(),
    banditStage: z.enum(banditStageType).optional(),
    banditStageDateStarted: z.date().optional(),
    banditScheduleValue: z.number().optional(),
    banditScheduleUnit: z.enum(["hours", "days"]).optional(),
    banditBurnInValue: z.number().optional(),
    banditBurnInUnit: z.enum(["hours", "days"]).optional(),
    banditConversionWindowValue: z.number().optional().nullable(),
    banditConversionWindowUnit: z.enum(["hours", "days"]).optional().nullable(),
    templateId: z.string().optional(),
    customFields: z.record(z.string(), z.any()).optional(),
  })
  .strict();

export type ExperimentRule = z.infer<typeof experimentRule>;

const experimentRefVariation = z
  .object({
    variationId: z.string(),
    value: z.string(),
  })
  .strict();

export type ExperimentRefVariation = z.infer<typeof experimentRefVariation>;

const experimentRefRule = baseRule
  .extend({
    type: z.literal("experiment-ref"),
    experimentId: z.string(),
    variations: z.array(experimentRefVariation),
  })
  .strict();

export type ExperimentRefRule = z.infer<typeof experimentRefRule>;

export const safeRolloutRule = baseRule
  .extend({
    type: z.literal("safe-rollout"),
    controlValue: z.string(),
    variationValue: z.string(),
    safeRolloutId: z.string(),
    // safeRolloutRule is a nested validator for feature rules, not a BaseModel entity,
    // so the defaultValues mechanism doesn't apply. We need .default() here.
    // eslint-disable-next-line no-restricted-syntax
    status: z.enum(safeRolloutStatusArray).default("running"),
    hashAttribute: z.string(),
    seed: z.string(),
    trackingKey: z.string(),
  })
  .strict();

export type SafeRolloutRule = z.infer<typeof safeRolloutRule>;
export const featureRule = z.union([
  forceRule,
  rolloutRule,
  experimentRule,
  experimentRefRule,
  safeRolloutRule,
]);

export type FeatureRule = z.infer<typeof featureRule>;

export const featureEnvironment = z
  .object({
    enabled: z.boolean(),
    prerequisites: z.array(featurePrerequisite).optional(),
    rules: z.array(featureRule),
  })
  .strict();

export type FeatureEnvironment = z.infer<typeof featureEnvironment>;

export const JSONSchemaDef = z
  .object({
    schemaType: z.enum(["schema", "simple"]),
    schema: z.string(),
    simple: simpleSchemaValidator,
    date: z.date(),
    enabled: z.boolean(),
  })
  .strict();

const revisionLog = z
  .object({
    user: eventUser,
    timestamp: z.date(),
    action: z.string(),
    subject: z.string(),
    value: z.string(),
  })
  .strict();

export type RevisionLog = z.infer<typeof revisionLog>;

const revisionRulesSchema = z.record(z.string(), z.array(featureRule));
export type RevisionRules = z.infer<typeof revisionRulesSchema>;

export const revisionStatusSchema = z.enum([
  "draft",
  "published",
  "discarded",
  "approved",
  "changes-requested",
  "pending-review",
  // Held child revision created by a ramp schedule; auto-published when the parent
  // controller revision is approved/published. Not user-actionable directly.
  "pending-parent",
]);

export type RevisionStatus = z.infer<typeof revisionStatusSchema>;

export const activeDraftStatusSchema = revisionStatusSchema.exclude([
  "published",
  "discarded",
  "pending-parent", // Excluded — managed by ramp schedule, not user-actionable
]);

export type ActiveDraftStatus = z.infer<typeof activeDraftStatusSchema>;

export const ACTIVE_DRAFT_STATUSES = activeDraftStatusSchema.options;

const minimalFeatureRevisionInterface = z
  .object({
    version: z.number(),
    datePublished: z.union([z.null(), z.date()]),
    dateUpdated: z.date(),
    createdBy: eventUser,
    status: revisionStatusSchema,
    comment: z.string(),
    title: z.string().optional(),
    contributors: z.array(eventUser).optional(),
  })
  .strict();

export type MinimalFeatureRevisionInterface = z.infer<
  typeof minimalFeatureRevisionInterface
>;

const revisionMetadataSchema = z.object({
  description: z.string().optional(),
  owner: ownerField.optional(),
  project: z.string().optional(),
  tags: z.array(z.string()).optional(),
  neverStale: z.boolean().optional(),
  customFields: z.record(z.string(), z.any()).optional(),
  jsonSchema: JSONSchemaDef.optional(),
  valueType: z.enum(featureValueType).optional(),
});

export type RevisionMetadata = z.infer<typeof revisionMetadataSchema>;

// Ramp schedule actions stored on a revision. Deferred until publish. Only
// create/detach are revision-bound — state changes (pause, resume, …) run
// real-time on the live ramp schedule.
const revisionRampEndConditionSchema = z.object({
  trigger: rampEndTrigger.optional(),
});

// API variant: targetType/targetId are inferred from the top-level ruleId
// at publish time.
const revisionApiRampStepAction = z.object({
  targetType: z.literal("feature-rule").optional(),
  targetId: z.string().optional(),
  patch: featureRulePatch.partial({ ruleId: true }),
});

const revisionApiRampStep = z.object({
  trigger: rampTrigger,
  actions: z.array(revisionApiRampStepAction).optional(),
  approvalNotes: z.string().nullish(),
});

// Stored type — requires targetType/targetId in actions.
export const revisionRampCreateAction = z.object({
  mode: z.literal("create"),
  /** Display name. Defaults to "Ramp schedule – {Month YYYY}" if omitted. */
  name: z.string().optional(),
  /** If set, patches are scoped to this environment only; absent/null applies to all environments sharing the ruleId. */
  environment: z.string().optional().nullable(),
  /** Load steps and endActions from a saved template. Explicit steps/endActions take precedence. */
  templateId: z.string().optional(),
  steps: z.array(rampStep),
  endActions: z.array(rampStepAction).optional(),
  /** ISO datetime string; absent/null means start immediately on publish. */
  startDate: z.string().optional().nullable(),
  endCondition: revisionRampEndConditionSchema.optional(),
  ruleId: z.string(),
});

// API input variant — normalize to RevisionRampCreateAction before storing.
export const apiRevisionRampCreateAction = revisionRampCreateAction.extend({
  steps: z.array(revisionApiRampStep).optional(),
  endActions: z.array(revisionApiRampStepAction).optional(),
});

export const revisionRampDetachAction = z.object({
  mode: z.literal("detach"),
  rampScheduleId: z.string(),
  /** Rule ID being detached. Used at publish time to remove the right target. */
  ruleId: z.string(),
  /** Delete the ramp schedule entirely if no targets remain after detach. */
  deleteScheduleWhenEmpty: z.boolean().optional(),
});

const revisionRampAction = z.discriminatedUnion("mode", [
  revisionRampCreateAction,
  revisionRampDetachAction,
]);

export type RevisionRampCreateAction = z.infer<typeof revisionRampCreateAction>;
export type ApiRevisionRampCreateAction = z.infer<
  typeof apiRevisionRampCreateAction
>;
export type RevisionRampDetachAction = z.infer<typeof revisionRampDetachAction>;
export type RevisionRampAction = z.infer<typeof revisionRampAction>;

const featureRevisionInterface = minimalFeatureRevisionInterface
  .extend({
    featureId: z.string(),
    organization: z.string(),
    baseVersion: z.number(),
    dateCreated: z.date(),
    publishedBy: z.union([z.null(), eventUser]),
    comment: z.string(),
    defaultValue: z.string(),
    rules: revisionRulesSchema,
    // Revision envelopes — only present when explicitly changed
    environmentsEnabled: z.record(z.string(), z.boolean()).optional(),
    prerequisites: z.array(featurePrerequisite).optional(),
    archived: z.boolean().optional(),
    metadata: revisionMetadataSchema.optional(),
    holdout: z
      .object({ id: z.string(), value: z.string() })
      .nullable()
      .optional(),
    // Ramp schedule actions (create/detach) to execute atomically when this revision
    // is published. This ensures ramp schedules are never orphaned by draft abandonment
    // or revision reverts. Real-time state changes (pause, resume, rollback, etc.)
    // are NOT stored here — they operate directly on live ramp schedule documents.
    rampActions: z.array(revisionRampAction).optional(),
    log: z.array(revisionLog).optional(), // This is deprecated in favor of using FeatureRevisionLog due to it being too large
    // Users (beyond the original author) who have made edits to this draft.
    // Populated incrementally via updateRevision; used for the self-approval block.
    contributors: z.array(eventUser).optional(),
  })
  .strict();

export type FeatureRevisionInterface = z.infer<typeof featureRevisionInterface>;

export const revisionChangesSchema = featureRevisionInterface
  .pick({
    title: true,
    comment: true,
    defaultValue: true,
    rules: true,
    baseVersion: true,
    environmentsEnabled: true,
    prerequisites: true,
    archived: true,
    metadata: true,
    holdout: true,
    rampActions: true,
  })
  .partial();

export type RevisionChanges = z.infer<typeof revisionChangesSchema>;

export const featureInterface = z
  .object({
    id: z.string(),
    archived: z.boolean().optional(),
    description: z.string().optional(),
    organization: z.string(),
    nextScheduledUpdate: z.union([z.date(), z.null()]).optional(),
    owner: ownerField,
    project: z.string().optional(),
    dateCreated: z.date(),
    dateUpdated: z.date(),
    valueType: z.enum(featureValueType),
    defaultValue: z.string(),
    version: z.number(),
    tags: z.array(z.string()).optional(),
    environmentSettings: z.record(z.string(), featureEnvironment),
    linkedExperiments: z.array(z.string()).optional(),
    jsonSchema: JSONSchemaDef.optional(),
    customFields: z.record(z.string(), z.any()).optional(),

    /** @deprecated */
    legacyDraft: z.union([featureRevisionInterface, z.null()]).optional(),
    /** @deprecated */
    legacyDraftMigrated: z.boolean().optional(),
    neverStale: z.boolean().optional(),
    prerequisites: z.array(featurePrerequisite).optional(),
    holdout: z
      .object({
        id: z.string(),
        value: z.string(),
      })
      .optional(),
  })
  .strict();

export type FeatureInterface = z.infer<typeof featureInterface>;

export const computedFeatureInterface = featureInterface
  .extend({
    projectId: z.string(),
    projectName: z.string(),
    projectIsDeReferenced: z.boolean(),
    savedGroups: z.array(z.string()),
    stale: z.boolean(),
    ownerName: z.string(),
  })
  .strict();

export type ComputedFeatureInterface = z.infer<typeof computedFeatureInterface>;

// ---------------------------------------------------------------------------
// API endpoint validators (hand-written to reference shared schema objects)
// ---------------------------------------------------------------------------

// ---- ScheduleRule (schemas/ScheduleRule.yaml) ----
export const apiScheduleRuleValidator = namedSchema(
  "ScheduleRule",
  z
    .object({
      enabled: z
        .boolean()
        .describe(
          "Whether the rule should be enabled or disabled at the specified timestamp.",
        ),
      timestamp: z
        .string()
        .meta({ format: "date-time" })
        .nullable()
        .describe("ISO timestamp when the rule should activate."),
    })
    .describe(
      "An array of schedule rules to turn on/off a feature rule at specific times. The array must contain exactly 2 elements (start rule and end rule). The first element is the start rule.",
    )
    .strict(),
);

// ---- FeatureBaseRule (schemas/FeatureBaseRule.yaml) ----
export const apiFeatureBaseRuleValidator = namedSchema(
  "FeatureBaseRule",
  z
    .object({
      description: z.string(),
      condition: z.string().optional(),
      id: z.string(),
      enabled: z.boolean(),
      scheduleRules: z
        .array(apiScheduleRuleValidator)
        .describe("Simple time-based on/off schedule for this rule")
        .optional(),
      scheduleType: z
        .enum(["none", "schedule", "ramp"])
        .describe(
          "UI hint for which scheduling mode is active:\n- `none` \u2013 no schedule\n- `schedule` \u2013 simple time-based enable/disable via `scheduleRules`\n- `ramp` \u2013 multi-step ramp-up controlled by an associated RampSchedule document\n",
        )
        .optional(),
      savedGroupTargeting: z
        .array(
          z.object({
            matchType: z.enum(["all", "any", "none"]),
            savedGroups: z.array(z.string()),
          }),
        )
        .optional(),
      prerequisites: z
        .array(
          z.object({
            id: z.string().describe("Feature ID of the prerequisite"),
            condition: z.string(),
          }),
        )
        .optional(),
    })
    .describe(
      "Common fields shared by all feature rule types. Specific rule types extend\nthis base with their own required properties (value, coverage, etc.).\n",
    )
    .strict(),
);

// ---- FeatureForceRule (schemas/FeatureForceRule.yaml) ----
export const apiFeatureForceRuleValidator = namedSchema(
  "FeatureForceRule",
  z.intersection(
    apiFeatureBaseRuleValidator
      .omit({})
      .describe(
        "Common fields shared by all feature rule types. Specific rule types extend\nthis base with their own required properties (value, coverage, etc.).\n",
      ),
    z.object({
      type: z.literal("force"),
      value: z.string(),
    }),
  ),
);

// ---- FeatureRolloutRule (schemas/FeatureRolloutRule.yaml) ----
export const apiFeatureRolloutRuleValidator = namedSchema(
  "FeatureRolloutRule",
  z.intersection(
    apiFeatureBaseRuleValidator
      .omit({})
      .describe(
        "Common fields shared by all feature rule types. Specific rule types extend\nthis base with their own required properties (value, coverage, etc.).\n",
      ),
    z.object({
      type: z.literal("rollout"),
      value: z.string(),
      coverage: z.coerce.number().gte(0).lte(1),
      hashAttribute: z.string(),
      seed: z
        .string()
        .describe(
          "Optional seed for the hash function; defaults to the rule id",
        )
        .optional(),
    }),
  ),
);

// ---- FeatureExperimentRule (schemas/FeatureExperimentRule.yaml) ----
export const apiFeatureExperimentRuleValidator = namedSchema(
  "FeatureExperimentRule",
  z.intersection(
    apiFeatureBaseRuleValidator
      .omit({})
      .describe(
        "Common fields shared by all feature rule types. Specific rule types extend\nthis base with their own required properties (value, coverage, etc.).\n",
      ),
    z.object({
      type: z.literal("experiment"),
      trackingKey: z.string().optional(),
      hashAttribute: z.string().optional(),
      fallbackAttribute: z.string().optional(),
      disableStickyBucketing: z.boolean().optional(),
      bucketVersion: z.coerce.number().optional(),
      minBucketVersion: z.coerce.number().optional(),
      namespace: z
        .object({
          enabled: z.boolean(),
          name: z.string(),
          range: z.array(z.coerce.number()).min(2).max(2),
        })
        .optional(),
      coverage: z.coerce.number().gte(0).lte(1).optional(),
      value: z
        .array(
          z.object({
            value: z.string(),
            weight: z.coerce.number(),
            name: z.string().optional(),
          }),
        )
        .describe("Variation values with weights")
        .optional(),
    }),
  ),
);

// ---- FeatureExperimentRefRule (schemas/FeatureExperimentRefRule.yaml) ----
export const apiFeatureExperimentRefRuleValidator = namedSchema(
  "FeatureExperimentRefRule",
  z.intersection(
    apiFeatureBaseRuleValidator
      .omit({})
      .describe(
        "Common fields shared by all feature rule types. Specific rule types extend\nthis base with their own required properties (value, coverage, etc.).\n",
      ),
    z.object({
      type: z.literal("experiment-ref"),
      variations: z.array(
        z.object({
          value: z.string(),
          variationId: z.string(),
        }),
      ),
      experimentId: z.string(),
    }),
  ),
);

// ---- FeatureSafeRolloutRule (schemas/FeatureSafeRolloutRule.yaml) ----
export const apiFeatureSafeRolloutRuleValidator = namedSchema(
  "FeatureSafeRolloutRule",
  z.intersection(
    apiFeatureBaseRuleValidator
      .omit({})
      .describe(
        "Common fields shared by all feature rule types. Specific rule types extend\nthis base with their own required properties (value, coverage, etc.).\n",
      ),
    z.object({
      type: z.literal("safe-rollout"),
      controlValue: z.string(),
      variationValue: z.string(),
      seed: z.string().optional(),
      hashAttribute: z.string().optional(),
      trackingKey: z.string().optional(),
      safeRolloutId: z.string().optional(),
      status: z
        .enum(["running", "released", "rolled-back", "stopped"])
        .optional(),
    }),
  ),
);

// ---- FeatureRule (schemas/FeatureRule.yaml) - anyOf / discriminated by type ----
export const apiFeatureRuleValidator = namedSchema(
  "FeatureRule",
  z.union([
    apiFeatureForceRuleValidator,
    apiFeatureRolloutRuleValidator,
    apiFeatureExperimentRuleValidator,
    apiFeatureExperimentRefRuleValidator,
    apiFeatureSafeRolloutRuleValidator,
  ]),
);

export type ApiFeatureForceRule = z.infer<typeof apiFeatureForceRuleValidator>;
export type ApiFeatureRule = z.infer<typeof apiFeatureRuleValidator>;

// ---- FeatureDefinition (schemas/FeatureDefinition.yaml) ----
export const apiFeatureDefinitionValidator = namedSchema(
  "FeatureDefinition",
  z
    .object({
      defaultValue: z.union([
        z.string(),
        z.coerce.number(),
        z.array(z.any()),
        z.record(z.string(), z.any()),
        z.null(),
      ]),
      rules: z
        .array(
          z.object({
            force: z
              .union([
                z.string(),
                z.coerce.number(),
                z.array(z.any()),
                z.record(z.string(), z.any()),
                z.null(),
              ])
              .optional(),
            weights: z.array(z.coerce.number()).optional(),
            variations: z
              .array(
                z.union([
                  z.string(),
                  z.coerce.number(),
                  z.array(z.any()),
                  z.record(z.string(), z.any()),
                  z.null(),
                ]),
              )
              .optional(),
            hashAttribute: z.string().optional(),
            namespace: z
              .array(z.union([z.coerce.number(), z.string()]))
              .min(3)
              .max(3)
              .optional(),
            key: z.string().optional(),
            coverage: z.coerce.number().optional(),
            condition: z.record(z.string(), z.any()).optional(),
          }),
        )
        .optional(),
    })
    .strict(),
);

// ---- FeatureEnvironment (schemas/FeatureEnvironment.yaml) ----
export const apiFeatureEnvironmentValidator = namedSchema(
  "FeatureEnvironment",
  z
    .object({
      enabled: z.boolean(),
      defaultValue: z.string(),
      rules: z.array(apiFeatureRuleValidator),
      definition: z
        .string()
        .describe(
          "A JSON stringified [FeatureDefinition](#tag/FeatureDefinition_model)",
        )
        .optional(),
      draft: z
        .object({
          enabled: z.boolean(),
          defaultValue: z.string(),
          rules: z.array(apiFeatureRuleValidator),
          definition: z
            .string()
            .describe(
              "A JSON stringified [FeatureDefinition](#tag/FeatureDefinition_model)",
            )
            .optional(),
        })
        .optional(),
    })
    .strict(),
);

export type ApiFeatureEnvironment = z.infer<
  typeof apiFeatureEnvironmentValidator
>;

// Holdout sub-object used in Feature
const apiFeatureHoldout = z
  .object({
    id: z.string().describe("Holdout ID"),
    value: z
      .string()
      .describe(
        "The feature value assigned to users in the holdout treatment group",
      ),
  })
  .nullable()
  .optional();

// Revision prerequisite sub-object (used in FeatureRevision)
const apiRevisionPrerequisite = z.object({
  id: z.string().describe("Feature ID"),
  condition: z.string(),
});

// Revision metadata sub-object
const apiRevisionMetadata = z
  .object({
    description: z.string().optional(),
    owner: ownerField.optional(),
    project: z.string().optional(),
    tags: z.array(z.string()).optional(),
    neverStale: z.boolean().optional(),
    valueType: z.string().optional(),
    jsonSchema: z
      .object({
        schemaType: z.enum(["schema", "simple"]).optional(),
        schema: z.string().optional(),
        simple: z.record(z.string(), z.any()).optional(),
        date: z.string().meta({ format: "date-time" }).optional(),
        enabled: z.boolean().optional(),
      })
      .optional(),
    customFields: z.record(z.string(), z.any()).optional(),
  })
  .describe(
    "Metadata fields captured in this revision (only present when metadata gating is enabled)",
  );

// ---- FeatureRevision (schemas/FeatureRevision.yaml) ----
export const apiFeatureRevisionValidator = namedSchema(
  "FeatureRevision",
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
      rules: z.record(z.string(), z.array(apiFeatureRuleValidator)),
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
        .record(z.string(), z.array(apiRevisionPrerequisite))
        .describe(
          "Per-environment prerequisites captured in this revision (only present when prerequisite gating is enabled)",
        )
        .optional(),
      prerequisites: z
        .array(apiRevisionPrerequisite)
        .describe(
          "Feature-level prerequisites captured in this revision (only present when prerequisite gating is enabled)",
        )
        .optional(),
      metadata: apiRevisionMetadata.optional(),
    })
    .strict(),
);

// ---- Feature (schemas/Feature.yaml) ----
export const apiFeatureValidator = namedSchema(
  "Feature",
  z
    .object({
      id: z.string(),
      dateCreated: z.string().meta({ format: "date-time" }),
      dateUpdated: z.string().meta({ format: "date-time" }),
      archived: z.boolean(),
      description: z.string(),
      owner: ownerField,
      project: z.string(),
      valueType: z.enum(["boolean", "string", "number", "json"]),
      defaultValue: z.string(),
      tags: z.array(z.string()),
      environments: z.record(z.string(), apiFeatureEnvironmentValidator),
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

// ---- FeatureWithRevisions (schemas/FeatureWithRevisions.yaml) ----
export const apiFeatureWithRevisionsValidator = namedSchema(
  "FeatureWithRevisions",
  z.intersection(
    apiFeatureValidator,
    z.object({
      revisions: z.array(apiFeatureRevisionValidator).optional(),
    }),
  ),
);

export type ApiFeature = z.infer<typeof apiFeatureValidator>;
export type ApiFeatureWithRevisions = z.infer<
  typeof apiFeatureWithRevisionsValidator
>;

// ---- Payload-schema rule types for POST/PUT (postFeature/ directory) ----
// These are DIFFERENT from the response schema rules -- they have different
// required/optional fields and don't use allOf/intersection with base rule.

const postFeatureSavedGroupTargeting = z.object({
  matchType: z.enum(["all", "any", "none"]),
  savedGroups: z.array(z.string()),
});

const postFeaturePrerequisite = z.object({
  id: z.string().describe("Feature ID"),
  condition: z.string(),
});

const postFeatureForceRule = z.object({
  description: z.string().optional(),
  condition: z.string().describe("Applied to everyone by default.").optional(),
  savedGroupTargeting: z.array(postFeatureSavedGroupTargeting).optional(),
  prerequisites: z.array(apiRevisionPrerequisite).optional(),
  scheduleRules: z.array(apiScheduleRuleValidator).optional(),
  id: z.string().optional(),
  enabled: z.boolean().describe("Enabled by default").optional(),
  type: z.literal("force"),
  value: z.string(),
});

const postFeatureRolloutRule = z.object({
  description: z.string().optional(),
  condition: z.string().describe("Applied to everyone by default.").optional(),
  savedGroupTargeting: z.array(postFeatureSavedGroupTargeting).optional(),
  prerequisites: z.array(postFeaturePrerequisite).optional(),
  scheduleRules: z.array(apiScheduleRuleValidator).optional(),
  id: z.string().optional(),
  enabled: z.boolean().describe("Enabled by default").optional(),
  type: z.literal("rollout"),
  value: z.string(),
  coverage: z
    .number()
    .describe(
      "Percent of traffic included in this experiment. Users not included in the experiment will skip this rule.",
    ),
  hashAttribute: z.string(),
});

const postFeatureExperimentRefRule = z.object({
  description: z.string().optional(),
  id: z.string().optional(),
  enabled: z.boolean().describe("Enabled by default").optional(),
  type: z.literal("experiment-ref"),
  condition: z.string().optional(),
  savedGroupTargeting: z.array(postFeatureSavedGroupTargeting).optional(),
  prerequisites: z.array(postFeaturePrerequisite).optional(),
  scheduleRules: z.array(apiScheduleRuleValidator).optional(),
  variations: z.array(
    z.object({
      value: z.string(),
      variationId: z.string(),
    }),
  ),
  experimentId: z.string(),
});

const postFeatureExperimentRule = z.object({
  description: z.string().optional(),
  condition: z.string(),
  id: z.string().optional(),
  enabled: z.boolean().describe("Enabled by default").optional(),
  type: z.literal("experiment"),
  trackingKey: z.string().optional(),
  hashAttribute: z.string().optional(),
  fallbackAttribute: z.string().optional(),
  disableStickyBucketing: z.boolean().optional(),
  bucketVersion: z.number().optional(),
  minBucketVersion: z.number().optional(),
  namespace: z
    .object({
      enabled: z.boolean(),
      name: z.string(),
      range: z.array(z.number()).min(2).max(2),
    })
    .optional(),
  coverage: z.number().optional(),
  prerequisites: z.array(apiRevisionPrerequisite).optional(),
  scheduleRules: z.array(apiScheduleRuleValidator).optional(),
  values: z
    .array(
      z.object({
        value: z.string(),
        weight: z.number(),
        name: z.string().optional(),
      }),
    )
    .optional(),
  value: z
    .array(
      z.object({
        value: z.string(),
        weight: z.number(),
        name: z.string().optional(),
      }),
    )
    .describe(
      "Support passing values under the value key as that was the original spec for FeatureExperimentRules",
    )
    .optional()
    .meta({ deprecated: true }),
});

const postFeatureRule = z.union([
  postFeatureForceRule,
  postFeatureRolloutRule,
  postFeatureExperimentRefRule,
  postFeatureExperimentRule,
]);

const postFeatureEnvironment = z.object({
  enabled: z.boolean(),
  rules: z.array(postFeatureRule),
  definition: z
    .string()
    .describe(
      "A JSON stringified [FeatureDefinition](#tag/FeatureDefinition_model)",
    )
    .optional(),
  draft: z
    .object({
      enabled: z.boolean().optional(),
      rules: z.array(postFeatureRule),
      definition: z
        .string()
        .describe(
          "A JSON stringified [FeatureDefinition](#tag/FeatureDefinition_model)",
        )
        .optional(),
    })
    .describe("Use to write draft changes without publishing them.")
    .optional(),
});

// ---- Shared sub-schemas for route validators ----

const idParams = z
  .object({
    id: z.string().describe("The id of the requested resource"),
  })
  .strict();

const featureResponseSchema = z
  .object({ feature: apiFeatureValidator })
  .strict();

// ---- PostFeaturePayload ----
const postFeatureBody = z
  .object({
    id: z
      .string()
      .min(1)
      .describe(
        "A unique key name for the feature. Feature keys can only include letters, numbers, hyphens, and underscores.",
      ),
    archived: z.boolean().optional(),
    description: z.string().describe("Description of the feature").optional(),
    owner: ownerInputField,
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
    environments: z
      .record(z.string(), postFeatureEnvironment)
      .describe(
        "A dictionary of environments that are enabled for this feature. Keys supply the names of environments. Environments belong to organization and are not specified will be disabled by default.",
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

// ---- UpdateFeaturePayload ----
const updateFeatureBody = z
  .object({
    description: z.string().describe("Description of the feature").optional(),
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
    environments: z.record(z.string(), postFeatureEnvironment).optional(),
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

export const listFeaturesValidator = {
  bodySchema: z.never(),
  querySchema: z
    .object({
      ...paginationQueryFields,
      projectId: z.string().describe("Filter by project id").optional(),
      clientKey: z
        .string()
        .describe("Filter by a SDK connection's client key")
        .optional(),
      ...skipPaginationQueryField,
    })
    .strict(),
  paramsSchema: z.never(),
  responseSchema: z.intersection(
    z.object({
      features: z.array(apiFeatureValidator),
    }),
    apiPaginationFieldsValidator,
  ),
  summary: "Get all features",
  description:
    "Returns features with pagination. The skipPagination query parameter is\nhonored only when API_ALLOW_SKIP_PAGINATION is set (self-hosted deployments).\n",
  operationId: "listFeatures",
  tags: ["features"],
  method: "get" as const,
  path: "/features",
};

export const postFeatureValidator = {
  bodySchema: postFeatureBody,
  querySchema: z.never(),
  paramsSchema: z.never(),
  responseSchema: featureResponseSchema,
  summary: "Create a single feature",
  operationId: "postFeature",
  tags: ["features"],
  method: "post" as const,
  path: "/features",
};

export const getFeatureValidator = {
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
    .object({
      feature: apiFeatureWithRevisionsValidator,
    })
    .strict(),
  summary: "Get a single feature",
  operationId: "getFeature",
  tags: ["features"],
  method: "get" as const,
  path: "/features/:id",
  exampleRequest: { params: { id: "abc123" } },
};

export const updateFeatureValidator = {
  bodySchema: updateFeatureBody,
  querySchema: z.never(),
  paramsSchema: idParams,
  responseSchema: featureResponseSchema,
  summary: "Partially update a feature",
  description:
    'Updates any combination of a feature\'s metadata (description, owner, tags, project), default value, environment settings (rules, kill switches, enabled state), prerequisites, holdout assignment, or JSON schema validation. All provided fields are merged into the existing feature and the result is immediately published as a new revision.\n\nReturns 403 if the API key lacks permission or if approval rules are enabled for an affected environment and the org setting "REST API always bypasses approval requirements" is off.\n',
  operationId: "updateFeature",
  tags: ["features"],
  method: "post" as const,
  path: "/features/:id",
};

export const deleteFeatureValidator = {
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
    'Permanently deletes a feature and all of its revisions.\n\nArchived features can be deleted freely. Deleting a live (non-archived) feature returns 403 unless the org setting "REST API always bypasses approval requirements" is enabled, or the API key lacks delete permission.\n',
  operationId: "deleteFeature",
  tags: ["features"],
  method: "delete" as const,
  path: "/features/:id",
  exampleRequest: { params: { id: "abc123" } },
};

export const toggleFeatureValidator = {
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
  responseSchema: featureResponseSchema,
  summary: "Toggle a feature in one or more environments",
  description:
    'Enables or disables a feature in one or more environments simultaneously. Accepts a map of environment name → boolean and immediately publishes the change.\n\nReturns 403 if the API key lacks permission or if approval rules are enabled for an affected environment and the org setting "REST API always bypasses approval requirements" is off.\n',
  operationId: "toggleFeature",
  tags: ["features"],
  method: "post" as const,
  path: "/features/:id/toggle",
  exampleRequest: {
    body: {
      reason: "Kill switch activated",
      environments: { production: false },
    },
  },
};

export const revertFeatureValidator = {
  bodySchema: z
    .object({
      revision: z.number(),
      comment: z.string().optional(),
    })
    .strict(),
  querySchema: z.never(),
  paramsSchema: idParams,
  responseSchema: featureResponseSchema,
  summary: "Revert a feature to a specific revision",
  description:
    'Creates a new revision whose rules and values match a previously-published revision, then immediately publishes it. This leaves a clear audit trail of the revert action in the revision history.\n\nReturns 403 if the API key lacks permission or if approval rules are enabled for an affected environment and the org setting "REST API always bypasses approval requirements" is off.\n',
  operationId: "revertFeature",
  tags: ["features"],
  method: "post" as const,
  path: "/features/:id/revert",
  exampleRequest: { body: { revision: 3, comment: "Bug found" } },
};

export const getFeatureRevisionsValidator = {
  bodySchema: z.never(),
  querySchema: z
    .object({
      ...paginationQueryFields,
      ...skipPaginationQueryField,
      status: revisionStatusSchema.optional(),
      author: z.string().optional(),
    })
    .strict(),
  paramsSchema: idParams,
  responseSchema: z
    .object({
      revisions: z.array(apiFeatureRevisionValidator),
    })
    .extend(apiPaginationFieldsValidator.shape),
  summary: "List revisions for a feature",
  description:
    "Returns a paginated list of revisions for this feature, sorted newest-first. Optionally filtered by status and/or author.",
  operationId: "getFeatureRevisions",
  tags: ["feature-revisions"],
  method: "get" as const,
  path: "/features/:id/revisions",
  exampleRequest: { params: { id: "abc123" } },
};

export const getFeatureStaleValidator = {
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
            featureId: z.string().describe("The feature key"),
            isStale: z
              .boolean()
              .describe(
                "Whether the feature is considered stale overall (all enabled environments are stale). Always false when neverStale is true.",
              ),
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
              .nullable()
              .describe(
                "Reason for the feature's stale or non-stale status. `never-stale` when stale detection is disabled. Non-stale reasons: `recently-updated`, `active-draft`, `has-dependents`. Stale reasons: `no-rules`, `rules-one-sided`, `abandoned-draft`, `toggled-off`. Null when non-stale with no single cause (see staleByEnv).\n",
              ),
            neverStale: z
              .boolean()
              .describe(
                "When true the feature is permanently excluded from stale detection.",
              ),
            staleByEnv: z
              .record(
                z.string(),
                z.object({
                  isStale: z
                    .boolean()
                    .describe("Whether this environment is stale"),
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
                    .nullable()
                    .describe(
                      "Reason for the stale status in this environment",
                    ),
                  evaluatesTo: z
                    .string()
                    .describe(
                      "The deterministic value this feature evaluates to in this environment. Uses the same raw string encoding as `feature.defaultValue`. Only present when the value is deterministic or the environment is toggled off.\n",
                    )
                    .optional(),
                }),
              )
              .describe(
                "Per-environment staleness breakdown, keyed by environment ID. Present when environments exist and neverStale is false.",
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
  operationId: "getFeatureStale",
  tags: ["features"],
  method: "get" as const,
  path: "/stale-features",
};

export const getFeatureKeysValidator = {
  bodySchema: z.never(),
  querySchema: z
    .object({
      projectId: z.string().describe("Filter by project id").optional(),
    })
    .strict(),
  paramsSchema: z.never(),
  responseSchema: z.array(z.string()),
  summary: "Get list of feature keys",
  operationId: "getFeatureKeys",
  tags: ["features"],
  method: "get" as const,
  path: "/feature-keys",
};

// ---- Derived types ----

export type ListFeaturesResponse = z.infer<
  typeof listFeaturesValidator.responseSchema
>;

export type GetFeatureStaleResponse = z.infer<
  typeof getFeatureStaleValidator.responseSchema
>;

export type FeatureStaleEntry = GetFeatureStaleResponse["features"][string];
