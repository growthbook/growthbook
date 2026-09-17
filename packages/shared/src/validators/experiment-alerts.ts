import { z } from "zod";
import { statsEngines } from "shared/constants";
import { experimentResultsType } from "./experiments";

export const experimentStartedNotificationPayload = z
  .object({
    type: z.literal("started"),
    experimentId: z.string(),
    experimentName: z.string(),
    phaseName: z.string().optional(),
    // Expanded goal metric names (metric groups resolved), in experiment order.
    goalMetricNames: z.array(z.string()).optional(),
    linkedFeatureCount: z.number().int().nonnegative().optional(),
    visualChangesetCount: z.number().int().nonnegative().optional(),
    urlRedirectCount: z.number().int().nonnegative().optional(),
  })
  .strict();

// One variation's result for the top goal metric, captured from the latest
// successful snapshot when the experiment stopped. Relative numbers (uplift,
// ci) are fractions of the control value, matching the results table.
export const experimentStoppedVariationResult = z
  .object({
    variationId: z.string(),
    variationName: z.string(),
    variationIndex: z.number().int().nonnegative(),
    users: z.number().optional(),
    // Metric mean for the variation, unformatted.
    value: z.number(),
    uplift: z.number().optional(),
    upliftStddev: z.number().optional(),
    ci: z.tuple([z.number(), z.number()]).optional(),
    chanceToWin: z.number().optional(),
    pValue: z.number().optional(),
    // Whether the result cleared the organization's significance settings
    // (chance-to-win bounds or p-value threshold) at the time of the stop.
    significant: z.boolean().optional(),
  })
  .strict();

export const experimentStoppedGoalMetric = z
  .object({
    metricId: z.string(),
    metricName: z.string(),
    // True when a decrease is the desired direction for this metric.
    inverse: z.boolean().optional(),
    snapshotId: z.string(),
    statsEngine: z.enum(statsEngines),
    // Frequentist analyses only: the threshold the results were judged at, so
    // consumers can name the interval's level (1 - threshold). Absent on
    // events recorded before this was captured.
    pValueThreshold: z.number().gt(0).lt(1).optional(),
    differenceType: z.string(),
    control: z
      .object({
        variationId: z.string(),
        variationName: z.string(),
        users: z.number().optional(),
        value: z.number(),
      })
      .strict(),
    variations: z.array(experimentStoppedVariationResult),
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
    winningVariationName: z.string().optional(),
    winningVariationIndex: z.number().int().nonnegative().optional(),
    totalUsers: z.number().optional(),
    // Whole days the final phase ran, from its start to the stop.
    durationDays: z.number().int().nonnegative().optional(),
    // Absent when no successful snapshot existed at stop time.
    goalMetric: experimentStoppedGoalMetric.optional(),
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

export type ExperimentStoppedGoalMetric = z.infer<
  typeof experimentStoppedGoalMetric
>;

export type ExperimentEndingSoonNotificationPayload = z.infer<
  typeof experimentEndingSoonNotificationPayload
>;

export type ExperimentStaleNotificationPayload = z.infer<
  typeof experimentStaleNotificationPayload
>;

export type ExperimentGuardrailFailedNotificationPayload = z.infer<
  typeof experimentGuardrailFailedNotificationPayload
>;

export type ExperimentBanditChangedNotificationPayload = z.infer<
  typeof experimentBanditChangedNotificationPayload
>;
