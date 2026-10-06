import { z } from "zod";
import { MAX_DESCRIPTION_LENGTH } from "shared/constants";
import { baseSchema } from "./base-model";
import { featureEnvironment } from "./features";
import { ownerField } from "./owner-field";
import { featurePrerequisite, savedGroupTargeting } from "./shared";

export const interleavingStatus = ["draft", "running", "stopped"] as const;
export type InterleavingStatus = (typeof interleavingStatus)[number];

export const interleavingMetricConfigValidator = z.discriminatedUnion(
  "attributionType",
  [
    z
      .object({
        id: z.string(),
        attributionType: z.literal("paired"),
      })
      .strict(),
    z
      .object({
        id: z.string(),
        attributionType: z.literal("ownershipByExposureCount"),
      })
      .strict(),
  ],
);
export type InterleavingMetricConfig = z.infer<
  typeof interleavingMetricConfigValidator
>;
export type InterleavingAttributionType =
  InterleavingMetricConfig["attributionType"];

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

    // Experiment id in exposures (`experiment_id`) and the pseudo flag key.
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

    // Analysis inputs frozen onto each snapshot.
    datasource: z.string(),
    interleavingQueryId: z.string(),
    userIdType: z.string(),
    metrics: z.array(interleavingMetricConfigValidator),

    // Targeting, validated and served like a feature rule's (CB pattern).
    coverage: z.number().min(0).max(1).optional(),
    condition: z.string().optional(),
    savedGroups: z.array(savedGroupTargeting).optional(),
    prerequisites: z.array(featurePrerequisite).optional(),

    // Per-environment on/off for the generated pseudo flag (holdout pattern).
    environmentSettings: z.record(z.string(), featureEnvironment),
  })
  .strict();

export type InterleavingInterface = z.infer<typeof interleavingValidator>;
