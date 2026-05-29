import type { Revision, ReviewDecision } from "shared/enterprise";
import type { Context } from "back-end/src/models/BaseModel";

/**
 * Entity-agnostic description of a revision lifecycle transition, passed to an
 * adapter's optional `onRevisionLifecycle` hook so it can emit webhook /
 * notification events. The action carries any data the model method has on hand
 * that the adapter would otherwise have to re-derive (e.g. the review decision).
 */
export type RevisionLifecycleAction =
  | { type: "created" }
  | { type: "updated" }
  | { type: "reviewRequested" }
  | {
      type: "reviewed";
      decision: ReviewDecision;
      userId: string;
      comment?: string;
    }
  | { type: "rebased" }
  | { type: "published" }
  | { type: "discarded" }
  | { type: "reopened" }
  | { type: "reverted" };

/**
 * Adapter interface that each entity type must implement to participate in the
 * revision system. All saved-group-specific logic lives in the saved-group adapter;
 * adding a new entity type requires only creating a new adapter and registering it.
 *
 * See revisions/adapters/saved-group.adapter.ts for the reference implementation.
 */
export interface EntityRevisionAdapter<
  TSnapshot extends Record<string, unknown> = Record<string, unknown>,
> {
  /** Return the BaseModel for this entity type, used for loading the live entity. */
  getModel(
    context: Context,
  ): { getById(id: string): Promise<TSnapshot | null> } | null;

  /** Normalize an entity object for storage as a revision snapshot. */
  buildSnapshot(entity: TSnapshot): TSnapshot;

  /** Whether the approval-flow revision workflow is required for this org/entity. */
  isRevisionRequired(context: Context): boolean;

  /**
   * The set of top-level field names that a merge is allowed to write to the
   * live entity. Used to filter desiredState before calling applyChanges.
   */
  getUpdatableFields(): ReadonlySet<string>;

  // ---------- Permissions ----------

  canRead(context: Context, snapshot: TSnapshot): boolean;
  canCreate(context: Context, snapshot: TSnapshot): boolean;
  canUpdate(context: Context, snapshot: TSnapshot): boolean;
  canDelete(context: Context, snapshot: TSnapshot): boolean;

  // ---------- Approval flow ----------

  /** Whether this org requires approval before a revision can be merged. */
  isApprovalRequired(context: Context): boolean;

  /**
   * Whether approval is required for this *specific* revision. Defaults to
   * `isApprovalRequired(context)` for adapters that don't care about the
   * revision's contents — override when an entity-type's review settings
   * gate on what changed (e.g. saved-group's `requireMetadataReview`, which
   * lets metadata-only revisions skip review).
   */
  isApprovalRequiredForRevision?(context: Context, revision: Revision): boolean;

  /** Whether the current user can bypass the approval requirement. */
  canBypassApproval(context: Context, snapshot: TSnapshot): boolean;

  // ---------- Merge ----------

  /**
   * Persist the computed changes (already filtered to updatable fields) back to
   * the live entity. Called by postMerge after conflicts are resolved.
   *
   * `options.isRevert` is set when the revision being merged carries a
   * `revertedFrom` link, so adapters can skip validations that would otherwise
   * block restoring a previously-published state.
   */
  applyChanges(
    context: Context,
    entity: TSnapshot,
    changes: Record<string, unknown>,
    options?: { isRevert?: boolean },
  ): Promise<void>;

  // ---------- Lifecycle events ----------

  /**
   * Optional hook invoked by RevisionModel after a revision state change is
   * persisted. Adapters use it to emit entity-specific webhook / notification
   * events. Implementations must be fire-and-forget (swallow their own errors)
   * so a failed notification never breaks the revision write. Entity types that
   * don't emit events simply omit it.
   */
  onRevisionLifecycle?(
    context: Context,
    revision: Revision,
    action: RevisionLifecycleAction,
  ): Promise<void>;
}
