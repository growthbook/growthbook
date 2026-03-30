import type { Context } from "back-end/src/models/BaseModel";

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

  /** Whether the current user can bypass the approval requirement. */
  canBypassApproval(context: Context, snapshot: TSnapshot): boolean;

  // ---------- Merge ----------

  /**
   * Persist the computed changes (already filtered to updatable fields) back to
   * the live entity. Called by postMerge after conflicts are resolved.
   */
  applyChanges(
    context: Context,
    entity: TSnapshot,
    changes: Record<string, unknown>,
  ): Promise<void>;
}
