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
    phase: z.number().int().nonnegative(),

    datasourceId: z.string(),
    exposureQueryId: z.string(),
    contextualAttributes: z.array(z.string()),

    goalMetrics: z.array(z.string()),
    secondaryMetrics: z.array(z.string()),
    metricSettings: z.record(z.string(), z.unknown()),

    variations: z.array(
      z.object({
        id: z.string(),
        weight: z.number(),
      }),
    ),

    maxContexts: z.number().int().positive(),
    treeModel: z.enum(["regression_tree", "linear_thompson"]),
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
    phase: z.number(),
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
  })
  .strict();

export type ContextualBanditSnapshotInterface = z.infer<
  typeof contextualBanditSnapshotValidator
>;
