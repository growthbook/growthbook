import { z } from "zod";
import { queryRunnerFailureCause } from "./queries";
import { experimentResultsType } from "./experiments";

export const experimentStartedNotificationPayload = z
  .object({
    type: z.literal("started"),
    experimentId: z.string(),
    experimentName: z.string(),
    phaseName: z.string().optional(),
    variationCount: z.number().optional(),
    linkedFeatureCount: z.number().int().nonnegative().optional(),
    visualChangesetCount: z.number().int().nonnegative().optional(),
    urlRedirectCount: z.number().int().nonnegative().optional(),
  })
  .strict();

export const experimentStoppedNotificationPayload = z
  .object({
    type: z.literal("stopped"),
    experimentId: z.string(),
    experimentName: z.string(),
    results: z.enum(experimentResultsType).optional(),
    releasedVariationName: z.string().optional(),
    enableTemporaryRollout: z.boolean(),
    reason: z.string().optional(),
  })
  .strict();

export const experimentEndingSoonNotificationPayload = z
  .object({
    type: z.literal("ending-soon"),
    experimentId: z.string(),
    experimentName: z.string(),
    endsAt: z.string(),
    daysRemaining: z.number(),
  })
  .strict();

export const experimentStaleNotificationPayload = z
  .object({
    type: z.literal("stale"),
    experimentId: z.string(),
    experimentName: z.string(),
    daysRunning: z.number(),
    reason: z.string(),
  })
  .strict();

export const experimentUpdateFailedNotificationPayload = z
  .object({
    type: z.literal("update-failed"),
    experimentId: z.string(),
    experimentName: z.string(),
    cause: queryRunnerFailureCause.exclude(["cancelled"]),
  })
  .strict();

export const experimentGuardrailFailedNotificationPayload = z
  .object({
    type: z.literal("guardrail-failed"),
    experimentId: z.string(),
    experimentName: z.string(),
    failedMetrics: z.array(
      z
        .object({
          id: z.string(),
          name: z.string(),
          variationName: z.string(),
        })
        .strict(),
    ),
  })
  .strict();

export const experimentBanditChangedNotificationPayload = z
  .object({
    type: z.literal("bandit-weights-changed"),
    experimentId: z.string(),
    experimentName: z.string(),
    currentWeights: z.array(z.number()),
    updatedWeights: z.array(z.number()),
  })
  .strict();

export type ExperimentStartedNotificationPayload = z.infer<
  typeof experimentStartedNotificationPayload
>;

export type ExperimentStoppedNotificationPayload = z.infer<
  typeof experimentStoppedNotificationPayload
>;

export type ExperimentEndingSoonNotificationPayload = z.infer<
  typeof experimentEndingSoonNotificationPayload
>;

export type ExperimentStaleNotificationPayload = z.infer<
  typeof experimentStaleNotificationPayload
>;

export type ExperimentUpdateFailedNotificationPayload = z.infer<
  typeof experimentUpdateFailedNotificationPayload
>;

export type ExperimentGuardrailFailedNotificationPayload = z.infer<
  typeof experimentGuardrailFailedNotificationPayload
>;

export type ExperimentBanditChangedNotificationPayload = z.infer<
  typeof experimentBanditChangedNotificationPayload
>;
