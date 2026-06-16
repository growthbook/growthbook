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
    exposureQueryId: z.string(),
    contextualAttributes: z.array(z.string()),

    goalMetrics: z.array(z.string()),
    metricSettings: z.record(z.string(), z.unknown()),

    variations: z.array(
      z.object({
        id: z.string(),
        weight: z.number(),
      }),
    ),

    minUsersPerLeaf: z.number().int().positive(),
    maxLeaves: z.number().int().positive(),
    canonicalFormVersion: z.number().int().nonnegative(),

    regressionAdjustmentEnabled: z.boolean(),

    startDate: z.date(),
    endDate: z.date().nullable().optional(),
    reweight: z.boolean(),
    banditWeightsSeed: z.number(),
  })
  .strict();

export type ContextualBanditSnapshotSettings = z.infer<
  typeof contextualBanditSnapshotSettingsValidator
>;

export const contextualBanditSnapshotValidator = baseSchema
  .extend({
    contextualBandit: z.string(),
    status: z.enum(["pending", "running", "success", "error", "partial"]),
    error: z.string().optional(),
    /** Nullable (not optional) to satisfy `InterfaceWithQueries` on the abstract `QueryRunner`. */
    runStarted: z.date().nullable(),
    queries: z.array(queryPointerValidator),
    /** Frozen copy so the snapshot stays self-contained even if the parent CB mutates. */
    frozenSettings: contextualBanditSnapshotSettingsValidator.optional(),
    contextualBanditEventId: z.string().nullable().optional(),
    weightsWereUpdated: z.boolean().optional(),
    triggeredBy: z.enum(["manual", "schedule"]).optional(),
    /**
     * Sample Ratio Mismatch computed per snapshot run. `statistic` is the
     * chi-square sum SUM((observed - expected)^2 / expected) over the usable
     * cells of the kept (leaf_id, bandit_version) groups, computed in SQL.
     * `degreesOfFreedom` is computed in SQL as
     * (sum of usable cells across kept groups) - (number of kept groups), and
     * `pValue` is derived from the statistic with those degrees of freedom.
     */
    srm: z
      .object({
        statistic: z.number(),
        pValue: z.number(),
        degreesOfFreedom: z.number().int().nonnegative(),
      })
      .optional(),
  })
  .strict();

export type ContextualBanditSnapshotInterface = z.infer<
  typeof contextualBanditSnapshotValidator
>;
