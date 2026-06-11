import { z } from "zod";
import { experimentResultsType } from "./experiments";

export const experimentStartedNotificationPayload = z
  .object({
    type: z.literal("started"),
    experimentId: z.string(),
    experimentName: z.string(),
    phaseName: z.string().optional(),
    variationCount: z.number(),
  })
  .strict();

export const experimentStoppedNotificationPayload = z
  .object({
    type: z.union([z.literal("shipped"), z.literal("rolledback")]),
    experimentId: z.string(),
    experimentName: z.string(),
    results: z.enum(experimentResultsType),
    releasedVariationName: z.string().optional(),
    enableTemporaryRollout: z.boolean(),
    reason: z.string().optional(),
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

export const experimentNoDataNotificationPayload = z
  .object({
    type: z.literal("no-data"),
    experimentId: z.string(),
    experimentName: z.string(),
  })
  .strict();

export const experimentQueryFailedNotificationPayload = z
  .object({
    type: z.literal("query-failed"),
    experimentId: z.string(),
    experimentName: z.string(),
    errorMessage: z.string().optional(),
  })
  .strict();

export const experimentStatusChangedNotificationPayload = z
  .object({
    type: z.literal("status-changed"),
    experimentId: z.string(),
    experimentName: z.string(),
    previousStatus: z.string(),
    currentStatus: z.string(),
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

export const experimentMetricRegressionNotificationPayload = z
  .object({
    type: z.literal("metric-regression"),
    experimentId: z.string(),
    experimentName: z.string(),
    metricId: z.string(),
    metricName: z.string(),
    variationName: z.string(),
    metricRole: z.enum(["goal", "secondary", "guardrail"]).optional(),
    uplift: z.number().optional(),
    ci: z.tuple([z.number(), z.number()]).optional(),
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

export const experimentHoldoutNotificationPayload = z
  .object({
    type: z.union([z.literal("holdout-created"), z.literal("holdout-updated")]),
    experimentId: z.string(),
    experimentName: z.string(),
  })
  .strict();

export type ExperimentStartedNotificationPayload = z.infer<
  typeof experimentStartedNotificationPayload
>;

export type ExperimentStoppedNotificationPayload = z.infer<
  typeof experimentStoppedNotificationPayload
>;

export type ExperimentGuardrailFailedNotificationPayload = z.infer<
  typeof experimentGuardrailFailedNotificationPayload
>;

export type ExperimentNoDataNotificationPayload = z.infer<
  typeof experimentNoDataNotificationPayload
>;

export type ExperimentQueryFailedNotificationPayload = z.infer<
  typeof experimentQueryFailedNotificationPayload
>;

export type ExperimentStatusChangedNotificationPayload = z.infer<
  typeof experimentStatusChangedNotificationPayload
>;

export type ExperimentEndingSoonNotificationPayload = z.infer<
  typeof experimentEndingSoonNotificationPayload
>;

export type ExperimentStaleNotificationPayload = z.infer<
  typeof experimentStaleNotificationPayload
>;

export type ExperimentMetricRegressionNotificationPayload = z.infer<
  typeof experimentMetricRegressionNotificationPayload
>;

export type ExperimentBanditChangedNotificationPayload = z.infer<
  typeof experimentBanditChangedNotificationPayload
>;

export type ExperimentHoldoutNotificationPayload = z.infer<
  typeof experimentHoldoutNotificationPayload
>;
