import type { Revision } from "shared/enterprise";
import type { Context } from "back-end/src/models/BaseModel";
import type { PublishGate } from "back-end/src/revisions/publishGates";
import type { ClaimBaseline } from "back-end/src/revisions/bulkPublish/types";

/**
 * A revision as the bulk publisher sees it, across both revision stores. The
 * generic store returns real `Revision` docs; the feature store adapts
 * FeatureRevisionInterface into this shape. `raw` carries the store's native
 * doc for the adapter's own methods — the orchestrator never inspects it.
 */
export type BulkRevisionRef = {
  id: string;
  version: number;
  status: string;
  dateUpdated: Date;
  raw: Revision | Record<string, unknown>;
  /**
   * Set by claim(): the fingerprint the adapter's releaseClaim uses to prove
   * the claim is still ours (features stamp datePublished at claim time).
   */
  claimStamp?: Date | null;
  /**
   * Set by applyPrecomputed(): the entity doc as actually persisted (writes
   * may normalize), the ownership baseline for restorePreImage.
   */
  writtenEntity?: Record<string, unknown> | null;
};

/**
 * Per-entity-type surface for the bulk publisher — the orchestrator
 * (bulkPublish.ts) contains zero entity-type switches. Implementations:
 * makeGenericBulkAdapter() (any generically-revisioned entity) and
 * featureBulkAdapter.
 *
 * Atomicity contract: everything that can fail deterministically
 * (permissions, validation, guards, hooks, merge computation) runs in the
 * plan-phase methods; claim() may fail ONLY on a CAS/baseline conflict, before
 * any live write; applyPrecomputed() may still throw on residual model-level
 * write validation, which the orchestrator treats as compensation-triggering.
 */
export interface BulkPublishableAdapter {
  /**
   * Whether the org REST-bypass setting (in addition to the bypass-approval
   * permission) grants stale-base force-merge authority — true for the
   * generic entities, false for features.
   */
  staleBaseForceAllowsRestBypass: boolean;

  // ---------- Plan phase (read-only) ----------

  loadEntity(
    context: Context,
    entityId: string,
  ): Promise<Record<string, unknown> | null>;

  loadRevision(
    context: Context,
    entity: Record<string, unknown>,
    version: number,
  ): Promise<BulkRevisionRef | null>;

  /** Publish authority over the entity (may be narrower than update). */
  canPublish(context: Context, entity: Record<string, unknown>): boolean;

  /** Update authority — rechecked against the post-merge desired state. */
  canUpdate(context: Context, entity: Record<string, unknown>): boolean;

  /** Whether the caller's authority bypasses the approval requirement. */
  canBypassApproval(context: Context, entity: Record<string, unknown>): boolean;

  /**
   * Compute the post-merge changes, or throw MergeConflictError when the
   * revision no longer merges cleanly. `desiredState` is adapter-opaque to the
   * orchestrator (generic: entity field changes; feature: MergeResultChanges).
   */
  buildDesiredState(
    context: Context,
    entity: Record<string, unknown>,
    revision: BulkRevisionRef,
  ): Promise<{
    desiredState: Record<string, unknown>;
    hasChanges: boolean;
    /** Post-merge entity doc for permission rechecks + the end-state overlay. */
    proposedEntity: Record<string, unknown>;
  }>;

  /**
   * Every publish gate for this item, evaluated against `overlayContext` (the
   * hypothetical multi-entity end-state): approval-required, stale-base,
   * entity locks, guard warnings, schema/hook validation. `callerContext`
   * carries the caller's identity for checks that must not use the admin-role
   * scan context. Gates are returned for every ACTIVE condition regardless of
   * the caller's authority — clearance is evaluated separately per item.
   */
  collectGates(args: {
    callerContext: Context;
    overlayContext: Context;
    entity: Record<string, unknown>;
    revision: BulkRevisionRef;
    desiredState: Record<string, unknown>;
    flags: {
      skipSchemaValidation: boolean;
      skipHooks: boolean;
      /** The publish comment — validation hooks may key on it. */
      comment?: string;
    };
  }): Promise<PublishGate[]>;

  // ---------- Commit phase (writes) ----------

  /**
   * Replay side effects a no-op merge would otherwise skip (applyChanges is
   * not called for items with no net entity change — e.g. a retry after a
   * partial apply whose descendant cascade never ran). Runs BEFORE the claim
   * so a failure leaves the draft open and retryable. Must be idempotent.
   */
  prepareNoOpMerge?(
    context: Context,
    entity: Record<string, unknown>,
    revision: BulkRevisionRef,
  ): Promise<void>;

  /**
   * CAS-claim the revision as merged/published, guarding on the plan-time
   * baseline (status + dateUpdated). Returns false on baseline conflict —
   * the orchestrator releases prior claims and aborts with 409.
   */
  claim(
    context: Context,
    revision: BulkRevisionRef,
    baseline: ClaimBaseline,
    options: { isApprovalBypass: boolean; comment?: string },
  ): Promise<boolean>;

  /** Compensation: restore the revision to its pre-claim state. */
  releaseClaim(context: Context, revision: BulkRevisionRef): Promise<void>;

  /** Write the precomputed desired state to the live entity. */
  applyPrecomputed(
    context: Context,
    entity: Record<string, unknown>,
    revision: BulkRevisionRef,
    desiredState: Record<string, unknown>,
  ): Promise<void>;

  /**
   * Compensation: restore the entity to its plan-time pre-image. Receives the
   * item's desiredState so the adapter can restore exactly the fields the
   * apply touched.
   */
  restorePreImage(
    context: Context,
    preImage: Record<string, unknown>,
    revision: BulkRevisionRef,
    desiredState: Record<string, unknown>,
  ): Promise<void>;

  // ---------- Post-commit (deferred side effects) ----------

  /**
   * Revision events/webhooks + audit + deferred finalization (e.g. ramp
   * update/detach/cleanup actions) for a successfully published item.
   * Receives the item's desiredState so adapters can read apply-phase state
   * stashed there.
   */
  emitPublished(
    context: Context,
    entity: Record<string, unknown>,
    revision: BulkRevisionRef,
    desiredState: Record<string, unknown>,
  ): Promise<void>;

  /**
   * The `revision.publishFailed` event for an item in a release whose commit
   * failed after claims (compensation ran). Not emitted for plan rejections
   * or claim conflicts — those never touched live state.
   */
  emitPublishFailed(
    context: Context,
    entity: Record<string, unknown>,
    revision: BulkRevisionRef,
    reason: string,
  ): Promise<void>;
}
