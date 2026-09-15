import type { Revision } from "shared/enterprise";
import type { Context } from "back-end/src/models/BaseModel";
import type { PublishGate } from "back-end/src/revisions/publishGates";
import type { ClaimBaseline } from "back-end/src/revisions/bulkPublish/types";

/** Store-neutral revision reference; raw retains the adapter's native document. */
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
   * Entity image reported by apply; null means no entity change, while undefined
   * means no report.
   */
  writtenEntity?: Record<string, unknown> | null;
  /** Release-owned cascade writes, restored after their root. */
  cascade?: {
    before: Record<string, unknown> & { id: string };
    written: Record<string, unknown>;
    /**
     * `dateUpdated` the cascade write left. A release publishing an ancestor and a
     * descendant together re-anchors the descendant's CAS baseline on this, so its
     * own guarded write isn't refused by the cascade that just preceded it.
     */
    stamp?: Date | null;
  }[];
  /**
   * Set by applyPrecomputed(): the entity fields the apply actually persisted
   * (post updatable-filter and post-normalization). restorePreImage rolls back
   * ONLY these, so a field the write dropped never clobbers a concurrent value.
   */
  persistedKeys?: string[];
  /** The guarded entity write lost its CAS, so restoration must be skipped. */
  casLost?: boolean;
};

/** Entity adapter for planning, guarded claims/apply, compensation, and effects. */
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

  /** Installs the other items' proposed states for this type in the overlay. */
  applyScanOverlay(
    overlayContext: Context,
    proposedEntities: Record<string, unknown>[],
  ): void;

  /** Returns active gates using the overlay for scans and callerContext for authority. */
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

  /** Replays idempotent no-op effects after claims; failure releases the claims. */
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

  /**
   * Compensation: reopen the revision to its pre-claim state. Returns false
   * when it was a NO-OP (the claim fingerprint no longer matches — a concurrent
   * publish re-claimed it, so it stays merged/published); the orchestrator then
   * reports the item stuck-published rather than a clean rollback.
   */
  releaseClaim(context: Context, revision: BulkRevisionRef): Promise<boolean>;

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
