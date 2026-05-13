import { z } from "zod";
import { baseSchema } from "./base-model";
import { queryPointerValidator } from "./queries";
import { contextualBanditQueryAttribute } from "./contextual-bandit-query";
import { contextualBanditTreeModel } from "./contextual-bandit-event";

export const contextualBanditSnapshotStatus = [
  /**
   * Initial state before the orchestrator (A6) starts work — exists so the
   * caller can mint a CBS id and return immediately while `runStarted` is
   * still unset.
   */
  "pending",
  "running",
  "success",
  "error",
] as const;
export type ContextualBanditSnapshotStatus =
  (typeof contextualBanditSnapshotStatus)[number];

export const contextualBanditSnapshotTriggeredBy = [
  "manual",
  "schedule",
  /**
   * Fired automatically when the experiment transitions between bandit
   * stages (explore ↔ exploit) per A6 orchestrator.
   */
  "phase_transition",
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
   * Phase index on the parent experiment that owned this tick. Duplicated
   * from `settings.phase` to support index-only lookups (per-phase history
   * + status filtering) without unpacking the frozen settings blob.
   */
  phase: z.number().int().nonnegative(),
  /**
   * Stable foreign key to the originating CBAQ. Duplicated from `settings`
   * to support index-only lookups via `getByDatasourceId`-style helpers
   * without unpacking the frozen settings blob.
   */
  contextualBanditQueryId: z.string(),
  /**
   * Optional: set when the orchestrator (A6) actually starts work. Absent
   * while `status === "pending"`.
   */
  runStarted: z.date().optional(),
  /** Set when the orchestrator terminates (success or error). */
  runFinished: z.date().optional(),
  status: z.enum(contextualBanditSnapshotStatus),
  /** Required (non-empty) when `status === "error"` — enforced in `customValidation`. */
  error: z.string().optional(),
  triggeredBy: z.enum(contextualBanditSnapshotTriggeredBy),
  /** Set when `triggeredBy === "manual"` — the user that fired the refresh. */
  triggeredByUser: z.string().optional(),
  /** Warehouse queries this snapshot owns; status drives orchestrator polling. */
  queries: z.array(queryPointerValidator),
  settings: contextualBanditSnapshotSettings,
  /** Total per-context rows the warehouse returned for the bucketing query. */
  rowsReturned: z.number().int().nonnegative().optional(),
  /**
   * Count of low-volume contexts the orchestrator (A6) folded into the
   * catch-all `"other"` leaf to satisfy the Mongo `Σ contexts × variations
   * ≤ 3000` cap.
   */
  contextsTrimmedToOther: z.number().int().nonnegative().optional(),
  /**
   * Mirrored from the produced CBE for fast filtering — lets the UI show
   * "weights changed" in the snapshot-history strip without re-fetching
   * the full event doc.
   */
  weightsWereUpdated: z.boolean().optional(),
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
