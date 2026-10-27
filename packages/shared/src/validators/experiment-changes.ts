import { z } from "zod";
import {
  featurePrerequisite,
  ignoreWarningsBodyField,
  savedGroupTargeting,
} from "./shared";

export const MAKE_CHANGES_DOC_URL =
  "https://docs.growthbook.io/app/making-experiment-changes#using-the-api";

// Each value reads `<phase>-<what happens to users already in the experiment>`.
export const releasePlans = [
  "same-phase-keep-assignments",
  "same-phase-reassign",
  "new-phase-rerandomize",
  "new-phase-keep-assignments",
  "new-phase-exclude-exposed",
] as const;
export type ReleasePlan = (typeof releasePlans)[number];

export const releasePlanSchema = z
  .enum(releasePlans)
  .describe(
    [
      "How to roll out a change that trades unbiased results against a stable user experience. Each value reads `<phase>-<what happens to users already in the experiment>`:",
      "- `same-phase-keep-assignments`: same phase, analysis continues. Exposed users keep their variation; the change applies to new traffic only. Needs Sticky Bucketing (except on Bandits).",
      "- `same-phase-reassign`: same phase, analysis continues. Exposed users are re-bucketed under the new settings, so some switch variation. Not offered on Bandits.",
      "- `new-phase-rerandomize`: new phase with a new seed. Everyone is re-randomized and the analysis restarts. On a Bandit, exploration restarts.",
      "- `new-phase-keep-assignments`: new phase with the same seed. Users keep their variation and the analysis restarts. `new-phase` changes only.",
      "- `new-phase-exclude-exposed`: new phase with a new seed. Users already exposed are excluded; only new users enter. `advanced` changes only; needs Sticky Bucketing.",
    ].join("\n"),
  );

export const experimentChangeTypes = [
  "coverage",
  "weights",
  "targeting",
  "namespace",
  "new-phase",
  "advanced",
] as const;
export type ExperimentChangeType = (typeof experimentChangeTypes)[number];

export const riskCodes = [
  "more-restrictive-targeting",
  "ambiguous-targeting-change",
  "decrease-coverage",
  "add-to-namespace",
  "decrease-namespace-range",
  "change-variation-weights",
  "multiple-changes",
  "bandit-restart",
] as const;
export type RiskCode = (typeof riskCodes)[number];

export const releasePlanUnavailableReasons = [
  "requires-sticky-bucketing",
  "unsafe-for-change-type",
] as const;
export type ReleasePlanUnavailableReason =
  (typeof releasePlanUnavailableReasons)[number];

export const releasePlanBiasLevels = ["none", "may-bias", "high-risk"] as const;
export type ReleasePlanBias = (typeof releasePlanBiasLevels)[number];

const releasePlanUnavailableReasonSchema = z
  .enum(releasePlanUnavailableReasons)
  .describe(
    "`requires-sticky-bucketing`: the plan needs Sticky Bucketing, which is off for this experiment. `unsafe-for-change-type`: the plan would bias results or reassign users for this change type. Standard experiments accept it under `changeType: advanced`; Bandits never do.",
  );

export const releasePlanAssessmentSchema = z.object({
  plan: releasePlanSchema,
  available: z
    .boolean()
    .describe("Whether this plan can be sent for this change."),
  unavailableReason: releasePlanUnavailableReasonSchema.nullable(),
  bias: z
    .enum(releasePlanBiasLevels)
    .describe("Statistical impact of this plan on the experiment's results."),
  usersMaySwitchVariation: z
    .boolean()
    .describe(
      "Whether some users already exposed may see a different variation.",
    ),
  analysisRestarts: z
    .boolean()
    .describe(
      "Whether the plan starts a new phase, restarting the analysis window.",
    ),
  banditRestarts: z
    .boolean()
    .describe(
      "Whether the Bandit's exploration restarts with equal weights. True for every plan on a Bandit.",
    ),
});
export type ReleasePlanAssessment = z.infer<typeof releasePlanAssessmentSchema>;

export const changeAssessmentSchema = z.object({
  requiresReleasePlan: z
    .boolean()
    .describe(
      "True when the change has a trade-off and must name a `releasePlan`. False means the change applies in place (same phase, same seed, no one reassigned) unless a plan is named.",
    ),
  risks: z
    .array(
      z.object({
        code: z.enum(riskCodes),
        message: z.string(),
      }),
    )
    .describe("Why the change is risky, one entry per reason."),
  recommendedReleasePlan: releasePlanSchema.describe(
    "The plan GrowthBook recommends for this change. Always an available plan.",
  ),
  releasePlans: z
    .array(releasePlanAssessmentSchema)
    .describe("Every plan offered for this change type, with its trade-offs."),
  docUrl: z.string(),
});
export type ChangeAssessment = z.infer<typeof changeAssessmentSchema>;

// Field → the change types that accept it, so a stray field can point to the
// right type.
const FIELD_CHANGE_TYPES: Record<string, ExperimentChangeType[]> = {
  coverage: ["coverage", "advanced"],
  trafficSplit: ["weights", "advanced"],
  targetingCondition: ["targeting", "advanced"],
  savedGroups: ["targeting", "advanced"],
  prerequisites: ["targeting", "advanced"],
  namespace: ["namespace", "advanced"],
};

function strayFieldMessage(changeType: ExperimentChangeType, key: string) {
  const types = FIELD_CHANGE_TYPES[key];
  if (!types) {
    return `\`${key}\` isn't a Make Changes field. Only the latest phase's delivery settings can be changed here.`;
  }
  return `\`${key}\` isn't part of a \`${changeType}\` change. Use ${types
    .filter((t) => t !== "advanced")
    .map((t) => `\`${t}\``)
    .join(" or ")}, or \`advanced\` to combine changes.`;
}

const commonFields = {
  releasePlan: releasePlanSchema
    .optional()
    .describe(
      "Required only when the change has a trade-off. Omit it and a risky change returns 422 `release_plan_required` listing the plans, their trade-offs, and the recommended one. A `new-phase` change always needs one.",
    ),
  reason: z
    .string()
    .trim()
    .max(1000)
    .optional()
    .describe(
      "Why this change is being made, in the requester's own words. Recorded in the experiment's history. When the change starts a new phase, it also becomes the closed phase's reason for stopping.",
    ),
  dryRun: z
    .boolean()
    .optional()
    .describe(
      "Set to true to preview. The request runs every check and returns the same response or error, but nothing is saved, and error bodies carry `dryRun: true`. A 200 dry run means the same request without `dryRun` will succeed, unless the experiment changes in between.",
    ),
  ignoreWarnings: ignoreWarningsBodyField,
};

const coverageField = z
  .number()
  .min(0)
  .max(1)
  .describe("Share of eligible users included in the experiment, from 0 to 1.");
const trafficSplitField = z
  .array(
    z.strictObject({
      variationId: z.string(),
      weight: z.number().min(0).max(1),
    }),
  )
  .min(2)
  .describe(
    "One weight per variation, keyed by `variationId`, summing to 1. Same shape as `trafficSplit` on the experiment's phases.",
  );
const targetingConditionField = z
  .string()
  .nullable()
  .describe(
    "Attribute targeting condition as a JSON string, as in the experiment's `targetingCondition`. `null` removes the condition. Omit to keep the current one.",
  );
const savedGroupsField = z
  .array(savedGroupTargeting)
  .nullable()
  .describe(
    "Saved Group targeting. `null` removes all of it. Omit to keep the current value.",
  );
const prerequisitesField = z
  .array(featurePrerequisite)
  .nullable()
  .describe(
    "Prerequisite Feature Flags. `null` removes all of them. Omit to keep the current ones.",
  );
const namespaceField = z
  .strictObject({
    namespaceId: z.string(),
    ranges: z
      .array(z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]))
      .min(1),
  })
  .nullable()
  .describe(
    "The namespace and the ranges of it this experiment occupies. A legacy namespace takes a single range. `null` takes the experiment out of its namespace.",
  );

function changeVariant<
  T extends ExperimentChangeType,
  S extends Record<string, z.ZodType>,
>(changeType: T, shape: S) {
  return z.strictObject(
    { changeType: z.literal(changeType), ...shape, ...commonFields },
    {
      error: (issue) =>
        issue.code === "unrecognized_keys"
          ? issue.keys.map((k) => strayFieldMessage(changeType, k)).join(" ")
          : undefined,
    },
  );
}

export const postExperimentChangesBody = z
  .discriminatedUnion("changeType", [
    changeVariant("coverage", { coverage: coverageField }),
    changeVariant("weights", { trafficSplit: trafficSplitField }),
    changeVariant("targeting", {
      targetingCondition: targetingConditionField.optional(),
      savedGroups: savedGroupsField.optional(),
      prerequisites: prerequisitesField.optional(),
    }),
    changeVariant("namespace", { namespace: namespaceField }),
    changeVariant("new-phase", {}),
    changeVariant("advanced", {
      coverage: coverageField.optional(),
      trafficSplit: trafficSplitField.optional(),
      targetingCondition: targetingConditionField.optional(),
      savedGroups: savedGroupsField.optional(),
      prerequisites: prerequisitesField.optional(),
      namespace: namespaceField.optional(),
    }),
  ])
  .describe(
    "One kind of change to the latest phase. Fields the request leaves out keep their current values; `null` clears a field. `advanced` combines several changes at once, which makes it harder to tell which one moved the results.",
  );
export type PostExperimentChangesBody = z.infer<
  typeof postExperimentChangesBody
>;
