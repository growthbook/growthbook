import { z } from "zod";
import { baseSchema } from "./base-model";
import { queryPointerValidator } from "./queries";

/**
 * Frozen, self-contained settings for a single CB snapshot run. Intentionally
 * CB-specific and `.strict()` so unrelated experiment fields can't bleed in.
 */
export const contextualBanditSnapshotSettingsValidator = z
  .object({
    experimentId: z.string(),
    trackingKey: z.string(),
    contextualBanditId: z.string(),

    datasourceId: z.string(),
    contextualBanditQueryId: z.string(),
    query: z.string(),
    userIdType: z.string(),
    contextualAttributes: z.array(z.string()),

    decisionMetric: z.string(),
    metricSettings: z.record(z.string(), z.unknown()),

    variations: z.array(
      z.object({
        id: z.string(),
        weight: z.number(),
      }),
    ),

    minUsersPerLeaf: z.number().int().positive(),
    maxLeaves: z.number().int().positive(),
    banditModelVersion: z.number().int().nonnegative(),

    startDate: z.date(),
    endDate: z.date().nullable().optional(),
    reweight: z.boolean(),
    banditWeightsSeed: z.number(),
  })
  .strict();

export type ContextualBanditSnapshotSettings = z.infer<
  typeof contextualBanditSnapshotSettingsValidator
>;

const trafficDimensionValidator = z.object({
  name: z.string(),
  srm: z.number(),
  variationUnits: z.array(z.number()),
});

/** Health traffic shape, matching `ExperimentSnapshotTraffic` for reuse of the experiment health UI. */
export const contextualBanditTrafficValidator = z.object({
  overall: trafficDimensionValidator,
  dimension: z.record(z.string(), z.array(trafficDimensionValidator)),
  error: z.string().optional(),
});

export const contextualBanditSnapshotValidator = baseSchema
  .extend({
    contextualBandit: z.string(),
    status: z.enum(["pending", "running", "success", "error", "partial"]),
    error: z.string().optional(),
    runStarted: z.date().nullable(),
    queries: z.array(queryPointerValidator),
    frozenSettings: contextualBanditSnapshotSettingsValidator.optional(),
    contextualBanditEventId: z.string().nullable().optional(),
    weightsWereUpdated: z.boolean().optional(),
    triggeredBy: z.enum(["manual", "schedule"]).optional(),
    srm: z
      .object({
        statistic: z.number(),
        pValue: z.number(),
        degreesOfFreedom: z.number().int().nonnegative(),
        // Illustrative observed vs expected per leaf & variation for the most
        // recent bandit period only. Does not reconcile to the p-value above.
        latestPeriod: z
          .object({
            banditVersion: z.string(),
            leaves: z.array(
              z.object({
                leafId: z.string(),
                observed: z.array(z.number()),
                expected: z.array(z.number()),
              }),
            ),
          })
          .optional(),
      })
      .optional(),
    multipleExposures: z.number().optional(),
    traffic: contextualBanditTrafficValidator.optional(),
  })
  .strict();

export type ContextualBanditSnapshotInterface = z.infer<
  typeof contextualBanditSnapshotValidator
>;
