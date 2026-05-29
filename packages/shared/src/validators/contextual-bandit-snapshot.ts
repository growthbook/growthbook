import { z } from "zod";
import { baseSchema } from "./base-model";
import { queryPointerValidator } from "./queries";

/**
 * Frozen, self-contained settings for a single contextual-bandit snapshot run.
 *
 * This is intentionally CB-specific and does NOT extend
 * `ExperimentSnapshotSettings`: that schema carries fields CB does not use
 * (e.g. `guardrailMetrics`, `activationMetric`, `regressionAdjustmentEnabled`),
 * and we want to prevent future drift from bleeding into CB runs.
 *
 * `.strict()` ensures any extra/legacy keys (notably `guardrailMetrics`) are
 * rejected at the validator boundary.
 */
export const contextualBanditSnapshotSettingsValidator = z
  .object({
    // --- Identifying ---
    /** GrowthBook experiment doc id (`exp_*`). Used for Mongo FK lookups. */
    experimentId: z.string(),
    /** Warehouse exposure filter key (`experiment.trackingKey || experiment.id`). */
    trackingKey: z.string(),
    contextualBanditId: z.string(),
    phase: z.number().int().nonnegative(),

    // --- Datasource + exposure query ---
    datasourceId: z.string(),
    exposureQueryId: z.string(),
    /** Ordered list of attribute column names used to derive context IDs. */
    contextualAttributes: z.array(z.string()),

    // --- Metrics ---
    goalMetrics: z.array(z.string()),
    secondaryMetrics: z.array(z.string()),
    /**
     * Per-metric settings/overrides. Typed loosely for now; will be tightened
     * to a `MetricForSnapshot`-style schema in a follow-up (see plan D1.1).
     */
    metricSettings: z.record(z.string(), z.unknown()),

    // --- Variations (id + traffic weight only — names/descriptions are not
    // needed by the stats engine). ---
    variations: z.array(
      z.object({
        id: z.string(),
        weight: z.number(),
      }),
    ),

    // --- Bandit knobs ---
    maxContexts: z.number().int().positive(),
    treeModel: z.enum(["regression_tree", "linear_thompson"]),
    minUsersPerLeaf: z.number().int().positive(),
    maxLeaves: z.number().int().positive(),
    canonicalFormVersion: z.number().int().nonnegative(),

    /** Resolved from experiment + metric CUPED settings at snapshot time. */
    regressionAdjustmentEnabled: z.boolean(),

    // --- Timing ---
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
    experiment: z.string(),
    phase: z.number(),
    status: z.enum(["pending", "running", "success", "error", "partial"]),
    error: z.string().optional(),
    /**
     * Wall-clock timestamp of when the runner kicked off the SQL pass. Null
     * until `ContextualBanditResultsQueryRunner.startAnalysis` writes it. Kept
     * nullable (rather than optional) so the doc shape satisfies
     * `InterfaceWithQueries` for the abstract `QueryRunner` base class.
     */
    runStarted: z.date().nullable(),
    /**
     * Query pointers managed by `ContextualBanditResultsQueryRunner`. Uses the
     * shared `queryPointerValidator` shape so the CBS doc plugs into the
     * abstract `QueryRunner<Model, ...>` machinery without a custom adapter.
     */
    queries: z.array(queryPointerValidator),
    /**
     * Frozen copy of the CB settings at the time the snapshot was created so
     * the snapshot remains self-contained even if the parent CB doc mutates.
     */
    frozenSettings: contextualBanditSnapshotSettingsValidator.optional(),
    /** ID of the ContextualBanditEvent produced by this snapshot (null until success). */
    contextualBanditEventId: z.string().nullable().optional(),
    /** True when arm weights were actually changed by this run. */
    weightsWereUpdated: z.boolean().optional(),
    triggeredBy: z.enum(["manual", "schedule"]).optional(),
  })
  .strict();

export type ContextualBanditSnapshotInterface = z.infer<
  typeof contextualBanditSnapshotValidator
>;
