import { z } from "zod";
import { baseSchema } from "./base-model";
import { queryPointerValidator } from "./queries";
import { contextualBanditQueryAttribute } from "./contextual-bandit-query";
import { contextualBanditTreeModel } from "./contextual-bandit-event";

export const contextualBanditSnapshotStatus = [
  "running",
  "success",
  "error",
] as const;
export type ContextualBanditSnapshotStatus =
  (typeof contextualBanditSnapshotStatus)[number];

export const contextualBanditSnapshotTriggeredBy = [
  "manual",
  "schedule",
] as const;
export type ContextualBanditSnapshotTriggeredBy =
  (typeof contextualBanditSnapshotTriggeredBy)[number];

/**
 * Frozen-at-run-time snapshot of the experiment + CBAQ + CB config used to
 * run a single contextual bandit tick. Persisted so the orchestrator (A6)
 * can reproduce results even if the underlying experiment/CBAQ is edited
 * mid-run.
 *
 * `attributes` carries the resolved top values / bucket edges as they
 * existed when the tick started — independent of any later
 * `refreshTopValuesForCBAQ` calls.
 */
export const contextualBanditSnapshotSettings = z
  .object({
    experimentId: z.string(),
    phase: z.number().int().nonnegative(),
    datasource: z.string(),
    exposureQueryId: z.string(),
    contextualBanditQueryId: z.string(),
    /** Frozen CBAQ attribute list at run-time (with cached values). */
    attributes: z.array(contextualBanditQueryAttribute),
    /** Frozen experiment variation ids in order. */
    variations: z.array(z.object({ id: z.string(), weight: z.number() })),
    treeModel: z.enum(contextualBanditTreeModel),
    /** Max distinct `contextId`s — extras collapse into a single "other" leaf (A6). */
    maxContexts: z.number().int().positive(),
    /** Fixed at `0` for MVP (sticky bucketing off, holdout off). */
    holdoutPercent: z.literal(0),
    stickyBucketing: z.literal(false),
    /** Optional WHERE clause forwarded to the warehouse SQL generator (A3). */
    queryFilter: z.string().optional(),
    /** Date range used by the orchestrator when querying the warehouse. */
    startDate: z.date(),
    endDate: z.date(),
  })
  .strict();
export type ContextualBanditSnapshotSettings = z.infer<
  typeof contextualBanditSnapshotSettings
>;

export const contextualBanditSnapshotValidator = baseSchema.safeExtend({
  experiment: z.string(),
  /**
   * Stable foreign key to the originating CBAQ. Duplicated from `settings`
   * to support index-only lookups via `getByDatasourceId`-style helpers
   * without unpacking the frozen settings blob.
   */
  contextualBanditQueryId: z.string(),
  runStarted: z.date(),
  status: z.enum(contextualBanditSnapshotStatus),
  /** Required (non-empty) when `status === "error"` — enforced in `customValidation`. */
  error: z.string().optional(),
  triggeredBy: z.enum(contextualBanditSnapshotTriggeredBy),
  /** Warehouse queries this snapshot owns; status drives orchestrator polling. */
  queries: z.array(queryPointerValidator),
  settings: contextualBanditSnapshotSettings,
  /**
   * Set when `status === "success"` — points to the CBE this snapshot
   * produced. Enforced in `customValidation`.
   */
  contextualBanditEventId: z.string().optional(),
});

export type ContextualBanditSnapshotInterface = z.infer<
  typeof contextualBanditSnapshotValidator
>;

/**
 * Type guards for the CBS lifecycle invariants. Kept as helpers so the
 * model and the orchestrator (A6) share a single definition of "valid
 * terminal state" without coupling on the model class itself.
 */
export function cbsRequiresContextualBanditEventId(
  doc: Pick<ContextualBanditSnapshotInterface, "status">,
): boolean {
  return doc.status === "success";
}

export function cbsRequiresError(
  doc: Pick<ContextualBanditSnapshotInterface, "status">,
): boolean {
  return doc.status === "error";
}
