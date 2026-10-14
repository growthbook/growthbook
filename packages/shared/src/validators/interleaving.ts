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

// Identity of an analysis within a metric. Results are keyed by (metric id,
// analysis key), so this has to stay stable.
export function interleavingAnalysisKey(a: InterleavingAnalysis): string {
  switch (a.type) {
    case "paired":
      return "paired";
    case "ownership":
      return a.attribution === "engagementSignal"
        ? `ownership:engagementSignal:${a.signalMetricId}`
        : `ownership:${a.attribution}`;
    default: {
      const unknown: never = a;
      throw new Error(`Unknown analysis: ${JSON.stringify(unknown)}`);
    }
  }
}

// Distinct engagement-signal metric ids used by a list of analyses.
export function interleavingSignalMetricIds(
  analyses: InterleavingAnalysis[],
): string[] {
  return [
    ...new Set(
      analyses.flatMap((a) =>
        a.type === "ownership" && a.attribution === "engagementSignal"
          ? [a.signalMetricId]
          : [],
      ),
    ),
  ];
}

// Key of one (metric, analysis) pair in snapshot results.
export function interleavingResultKey(
  metricId: string,
  a: InterleavingAnalysis,
): string {
  return `${metricId}::${interleavingAnalysisKey(a)}`;
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
