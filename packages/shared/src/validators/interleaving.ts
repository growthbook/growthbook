import { z } from "zod";
import { MAX_DESCRIPTION_LENGTH } from "shared/constants";
import { baseSchema } from "./base-model";
import { featureEnvironment, JSONSchemaDef } from "./features";
import { ownerField } from "./owner-field";
import { featurePrerequisite, savedGroupTargeting } from "./shared";

export const interleavingStatus = ["draft", "running", "stopped"] as const;
export type InterleavingStatus = (typeof interleavingStatus)[number];

// How ownership analysis decides which ranker owns a conversion. Paired
// analysis needs no equivalent — it counts engagement per competitive exposure.
export const interleavingOwnershipAttribution = [
  "exposureCount",
  "engagementSignal",
] as const;
export type InterleavingOwnershipAttribution =
  (typeof interleavingOwnershipAttribution)[number];

export const interleavingAnalysisValidator = z.discriminatedUnion("type", [
  z.object({ type: z.literal("paired") }).strict(),
  z.discriminatedUnion("attribution", [
    z
      .object({
        type: z.literal("ownership"),
        attribution: z.literal("exposureCount"),
      })
      .strict(),
    z
      .object({
        type: z.literal("ownership"),
        attribution: z.literal("engagementSignal"),
        // Fact metric whose events (e.g. clicks) decide which ranker owns an
        // item for a user. A metric can use several different signals.
        signalMetricId: z.string().min(1),
      })
      .strict(),
  ]),
]);
export type InterleavingAnalysis = z.infer<
  typeof interleavingAnalysisValidator
>;
export type InterleavingSignalAnalysis = Extract<
  InterleavingAnalysis,
  { attribution: "engagementSignal" }
>;

export function isSignalAnalysis(
  a: InterleavingAnalysis,
): a is InterleavingSignalAnalysis {
  return a.type === "ownership" && a.attribution === "engagementSignal";
}

// Identity of an analysis within a metric; used to reject duplicates.
export function interleavingAnalysisKey(a: InterleavingAnalysis): string {
  if (isSignalAnalysis(a)) {
    return `ownership:engagementSignal:${a.signalMetricId}`;
  }
  return a.type === "ownership" ? `ownership:${a.attribution}` : a.type;
}

// Distinct engagement-signal metric ids used by a list of analyses.
export function interleavingSignalMetricIds(
  analyses: InterleavingAnalysis[],
): string[] {
  return [
    ...new Set(analyses.filter(isSignalAnalysis).map((a) => a.signalMetricId)),
  ];
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

    jsonSchema: JSONSchemaDef.nullable(),

    // Analysis inputs.
    datasource: z.string(),
    interleavingQueryId: z.string(),
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
    environmentSettings: z.record(z.string(), featureEnvironment),
  })
  .strict();

export type InterleavingInterface = z.infer<typeof interleavingValidator>;
