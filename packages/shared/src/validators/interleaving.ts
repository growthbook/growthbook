import { z } from "zod";
import { FEATURE_KEY_PATTERN, MAX_DESCRIPTION_LENGTH } from "shared/constants";
import { apiBaseSchema, baseSchema } from "./base-model";
import { apiJSONSchemaDefInput, JSONSchemaDef } from "./features";
import { namedSchema } from "./openapi-helpers";
import { ownerEmailField, ownerField, ownerInputField } from "./owner-field";
import { featurePrerequisite, savedGroupTargeting } from "./shared";

export const interleavingStatus = ["draft", "running", "stopped"] as const;
export type InterleavingStatus = (typeof interleavingStatus)[number];

// How preference analysis decides which ranker gets credit for a conversion. Paired
// analysis needs no equivalent — it counts engagement per competitive exposure.
// Only exposure-count attribution for now; engagement-signal attribution
// (credit decided by a separate signal metric's events) comes later.
export const interleavingPreferenceAttribution = ["exposureCount"] as const;
export type InterleavingPreferenceAttribution =
  (typeof interleavingPreferenceAttribution)[number];

export const interleavingAnalysisValidator = z.discriminatedUnion("type", [
  z.object({ type: z.literal("paired") }).strict(),
  z
    .object({
      type: z.literal("preference"),
      attribution: z.enum(interleavingPreferenceAttribution),
    })
    .strict(),
]);
export type InterleavingAnalysis = z.infer<
  typeof interleavingAnalysisValidator
>;

// Identity of an analysis within a metric; used to reject duplicates.
export function interleavingAnalysisKey(a: InterleavingAnalysis): string {
  return a.type === "preference" ? `preference:${a.attribution}` : a.type;
}

export const interleavingMetricConfigValidator = z
  .object({
    id: z.string(),
    analyses: z.array(interleavingAnalysisValidator).min(1, {
      message: "Select at least one analysis for each metric.",
    }),
  })
  .strict()
  .refine(
    (m) =>
      new Set(m.analyses.map(interleavingAnalysisKey)).size ===
      m.analyses.length,
    { message: "Each analysis can only be added once per metric." },
  );
export type InterleavingMetricConfig = z.infer<
  typeof interleavingMetricConfigValidator
>;

export const interleavingVariationValidator = z
  .object({
    id: z.string(),
    key: z.string().regex(/\S/, "Variation key cannot be empty."),
    name: z.string(),
    description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
    config: z.string(),
  })
  .strict();
export type InterleavingVariation = z.infer<
  typeof interleavingVariationValidator
>;

// Interleaving environments only carry an on/off switch — the targeting knobs on
// featureEnvironment (rules, default value) have no meaning for a ranker.
const interleavingEnvironment = z.object({ enabled: z.boolean() }).strict();

const interleavingKeyField = z
  .string()
  .regex(
    new RegExp(FEATURE_KEY_PATTERN),
    "Interleaving keys can only include letters, numbers, and the characters _, -, ., :, and |.",
  );

export const interleavingValidator = baseSchema
  .extend({
    name: z.string(),
    description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
    project: z.string().optional(),
    owner: ownerField,
    tags: z.array(z.string()),
    archived: z.boolean(),

    status: z.enum(interleavingStatus),
    dateStarted: z.date().optional(),
    dateStopped: z.date().optional(),

    // Code-facing key, like a feature key: customer code passes it to
    // `interleave()` and the SDK payload's pseudo flag is `$interleave:<key>`.
    key: interleavingKeyField,
    // Experiment id in exposures (`experiment_id`), used only for analysis.
    // Unique per Data Source, so exposures can always be attributed to one
    // experiment; generated from `key` on create, with a suffix if taken.
    trackingKey: z.string(),
    // Per-user diversion into the interleaving (the draft itself is seeded
    // per impression by the SDK's ranking seed).
    hashAttribute: z.string(),
    seed: z.string(),

    // Exactly two rankers. The first is the default: users who aren't
    // interleaved (targeting miss, experiment off) get its list.
    variations: z.tuple([
      interleavingVariationValidator,
      interleavingVariationValidator,
    ]),

    jsonSchema: JSONSchemaDef.nullable(),

    // Analysis inputs.
    datasource: z.string(),
    interleavingExposureQueryId: z.string(),
    userIdType: z.string(),
    metrics: z
      .array(interleavingMetricConfigValidator)
      .refine((ms) => new Set(ms.map((m) => m.id)).size === ms.length, {
        message: "Each metric can only be added once.",
      }),

    // Targeting, validated and served like a feature rule's (CB pattern).
    coverage: z.number().min(0).max(1).optional(),
    condition: z.string().optional(),
    savedGroups: z.array(savedGroupTargeting).optional(),
    prerequisites: z.array(featurePrerequisite).optional(),

    // Per-environment on/off for the generated pseudo flag (holdout pattern).
    environmentSettings: z.record(z.string(), interleavingEnvironment),
  })
  .strict();

export type InterleavingInterface = z.infer<typeof interleavingValidator>;

const apiInterleavingVariation = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  description: z.string().optional(),
  config: z.string().describe("The ranker's config, as a JSON string"),
});

const apiInterleavingVariationInput = z.strictObject({
  key: interleavingVariationValidator.shape.key,
  name: z.string(),
  description: interleavingVariationValidator.shape.description,
  config: z
    .string()
    .describe(
      "The ranker's config, as a JSON string. Passed to `getList` in the SDK.",
    ),
});

const apiInterleavingVariationsInput = z
  .tuple([apiInterleavingVariationInput, apiInterleavingVariationInput])
  .describe(
    "Exactly two rankers. Users who are not exposed to interleaved rankings get the first ranker's list.",
  );

export const apiInterleavingValidator = namedSchema(
  "Interleaving",
  apiBaseSchema.safeExtend({
    name: z.string(),
    description: z.string().optional(),
    project: z.string().optional(),
    owner: ownerField,
    ownerEmail: ownerEmailField,
    tags: z.array(z.string()),
    archived: z.boolean(),

    status: z.enum(interleavingStatus),
    dateStarted: z.iso.datetime().optional(),
    dateStopped: z.iso.datetime().optional(),

    key: z
      .string()
      .describe("The key your code passes to `interleave()` as `key`"),
    trackingKey: z
      .string()
      .describe("The `experiment_id` recorded in exposures"),
    hashAttribute: z.string(),
    seed: z.string(),
    // Tuple, like the input: the arity is part of the contract both ways.
    variations: z
      .tuple([apiInterleavingVariation, apiInterleavingVariation])
      .describe("Exactly two rankers. Control (the default ranker) is first."),
    jsonSchema: apiJSONSchemaDefInput
      .safeExtend({ date: z.iso.datetime() })
      .describe("Validation schema for the rankers' configs")
      .nullable(),

    datasource: z.string(),
    interleavingExposureQueryId: z.string(),
    userIdType: z.string(),
    metrics: z.array(interleavingMetricConfigValidator),

    coverage: z.number().min(0).max(1).optional(),
    condition: z.string().optional(),
    savedGroups: z.array(savedGroupTargeting).optional(),
    prerequisites: z.array(featurePrerequisite).optional(),
    environmentSettings: z.record(z.string(), interleavingEnvironment),
  }),
);

export type ApiInterleavingInterface = z.infer<typeof apiInterleavingValidator>;

export const apiListInterleavingsValidator = {
  bodySchema: z.never(),
  querySchema: z.strictObject({
    projectId: z.string().optional(),
    datasourceId: z.string().optional(),
    trackingKey: z.string().optional(),
    key: z.string().optional(),
  }),
  paramsSchema: z.never(),
};

export const apiCreateInterleavingBody = z.strictObject({
  name: z.string(),
  description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
  project: z.string().optional(),
  owner: ownerInputField.optional(),
  tags: z.array(z.string()).optional(),

  key: interleavingKeyField.describe(
    "The key your code passes to `interleave()` as `key`. Can't be changed later. Several experiments may share a key so you can iterate without changing code, but only one of them can be running in a given environment.",
  ),
  trackingKey: z
    .string()
    .optional()
    .describe(
      "The `experiment_id` recorded in exposures. Leave this unset: it is generated from `key`, with a `_v1` style suffix when another experiment in this Data Source already uses it. Tracking keys must be unique within a Data Source, so supplying one that is taken is rejected.",
    ),
  hashAttribute: z.string().optional(),
  variations: apiInterleavingVariationsInput,
  jsonSchema: apiJSONSchemaDefInput.optional(),

  datasource: z.string(),
  interleavingExposureQueryId: z.string(),
  userIdType: z.string(),
  metrics: z.array(interleavingMetricConfigValidator).optional(),

  coverage: z.number().min(0).max(1).optional(),
  condition: z.string().optional(),
  savedGroups: z.array(savedGroupTargeting).optional(),
  prerequisites: z.array(featurePrerequisite).optional(),
  environmentSettings: z.record(z.string(), interleavingEnvironment).optional(),
});

export type ApiCreateInterleavingBody = z.infer<
  typeof apiCreateInterleavingBody
>;

export const apiUpdateInterleavingBody = z.strictObject({
  name: z.string().optional(),
  description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
  project: z.string().optional(),
  owner: ownerInputField.optional(),
  tags: z.array(z.string()).optional(),
  archived: z
    .boolean()
    .optional()
    .describe(
      "Archiving removes a running interleaving experiment from the SDK payload, so its rankers stop serving immediately.",
    ),

  trackingKey: z
    .string()
    .optional()
    .describe(
      "The `experiment_id` recorded in exposures. Must be unique within the Data Source. Changing it on a running experiment means earlier exposures are no longer counted.",
    ),
  hashAttribute: z.string().optional(),
  seed: z.string().optional(),
  variations: apiInterleavingVariationsInput
    .optional()
    .describe(
      "Replaces both rankers. Each keeps its id by position, so the first entry updates the first ranker.",
    ),
  jsonSchema: apiJSONSchemaDefInput.nullable().optional(),

  datasource: z.string().optional(),
  interleavingExposureQueryId: z.string().optional(),
  userIdType: z.string().optional(),
  metrics: z.array(interleavingMetricConfigValidator).optional(),

  coverage: z.number().min(0).max(1).optional(),
  condition: z.string().optional(),
  savedGroups: z.array(savedGroupTargeting).optional(),
  prerequisites: z.array(featurePrerequisite).optional(),
  environmentSettings: z.record(z.string(), interleavingEnvironment).optional(),
});

export type ApiUpdateInterleavingBody = z.infer<
  typeof apiUpdateInterleavingBody
>;

// `key` is code-facing, so it is never updatable.
export const INTERLEAVING_API_UPDATE_FIELDS = [
  "name",
  "description",
  "project",
  "tags",
  "archived",
  "trackingKey",
  "hashAttribute",
  "seed",
  "datasource",
  "interleavingExposureQueryId",
  "userIdType",
  "metrics",
  "coverage",
  "condition",
  "savedGroups",
  "prerequisites",
  "environmentSettings",
] as const satisfies readonly (keyof ApiUpdateInterleavingBody)[];

const interleavingIdParams = z.strictObject({
  id: z.string().describe("The interleaving experiment id"),
});

export const apiInterleavingStartValidator = {
  paramsSchema: interleavingIdParams,
  bodySchema: z.never(),
  querySchema: z.never(),
};

export const apiInterleavingStopValidator = {
  paramsSchema: interleavingIdParams,
  bodySchema: z.never(),
  querySchema: z.never(),
};

export const apiInterleavingLifecycleReturn = z.object({
  interleaving: apiInterleavingValidator,
});
