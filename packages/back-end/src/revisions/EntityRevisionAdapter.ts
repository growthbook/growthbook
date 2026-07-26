import { isEqual } from "lodash";
import type { Revision } from "shared/enterprise";
import type { Context } from "back-end/src/models/BaseModel";
import type { ArmAcknowledgments } from "back-end/src/services/armGuards";
import type { PublishGate } from "back-end/src/revisions/publishGates";

/**
 * Narrow a proposed-changes object to the fields an adapter may write, dropping
 * undefined or unchanged values. Shared by adapters' `applyChanges`. Lives in
 * this leaf module (not revisions/util) to avoid an adapter→util→index cycle.
 */
export function filterUpdatableChanges(
  changes: Record<string, unknown>,
  entity: Record<string, unknown>,
  updatableFields: ReadonlySet<string>,
): Record<string, unknown> {
  const filtered: Record<string, unknown> = {};
  for (const key of Object.keys(changes)) {
    if (!updatableFields.has(key)) continue;
    const newVal = changes[key];
    if (newVal !== undefined && !isEqual(newVal, entity[key])) {
      filtered[key] = newVal;
    }
  }
  return filtered;
}

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

  /**
   * Whether an *approved* revision should reset to pending-review when its
   * proposed changes are subsequently modified. Defaults (when not implemented)
   * to the entity's approval-flow `resetReviewOnChange` toggle. Override when the
   * decision depends on what changed and/or the settings live elsewhere — e.g.
   * constants, which use the feature `requireReviews` model.
   */
  shouldResetReviewOnChange?(context: Context, revision: Revision): boolean;

  /**
   * Whether auto-publish-on-approval may be armed for this entity. Defaults
   * (when not implemented) to the entity's approval-flow `autopublishOnApproval`
   * toggle. Override for entities whose review settings live elsewhere — e.g.
   * constants.
   */
  isAutopublishOnApprovalEnabled?(
    context: Context,
    snapshot: TSnapshot,
  ): boolean;

  // ---------- Merge ----------

  /**
   * Persist the computed changes (already filtered to updatable fields) back to
   * the live entity. Called by postMerge after conflicts are resolved.
   *
   * `options.isRevert` is set when the revision being merged carries a
   * `revertedFrom` link, so adapters can skip validations that would otherwise
   * block restoring a previously-published state.
   *
   * Returns the keys this call actually persisted on the entity — the changes
   * that survived the updatable filter AND any adapter normalization (e.g. a
   * config field stripped as owned by an ancestor). Bulk compensation restores
   * ONLY these keys, so a field the write dropped is never rolled back over a
   * concurrent writer's value. Single-entity callers ignore the return.
   */
  applyChanges(
    context: Context,
    entity: TSnapshot,
    changes: Record<string, unknown>,
    options?: { isRevert?: boolean },
  ): Promise<string[]>;

  /**
   * Validate that `desiredState` (the changes a merge would apply) can be
   * published, BEFORE the merge is claimed. Throwing here leaves the revision in
   * its current open status — nothing is marked merged — so a publish that fails
   * validation (e.g. a config value that violates a cross-field rule) errors
   * cleanly and keeps the draft editable, instead of stranding it "merged" and
   * relying on a post-merge reopen. Runs on every internal publish path,
   * including admin/bypass-approval publishes (bypass skips approval, not
   * validation). Optional: adapters without publish-time invariants can omit it.
   */
  assertPublishable?(
    context: Context,
    entity: TSnapshot,
    desiredState: Record<string, unknown>,
    revision: Revision,
    // `deferred` = this is a background/armed merge (scheduled publish or
    // auto-publish-on-approval), whose overrides are the arm-time snapshot on the
    // revision — NOT a synchronous manual publish (where a live ignoreWarnings/
    // bypass applies).
    options?: { isRevert?: boolean; deferred?: boolean },
  ): Promise<void>;

  /**
   * Non-throwing view of this entity's publish guards, for the REST publish
   * handlers' aggregated 422 (PublishBlockedError): evaluate the same guard
   * conditions the sequential asserts enforce and return one PublishGate per
   * live conflict set, so a blocked publish reports every gate — and the flag
   * that clears it — in one response. Gates the caller's authority or request
   * disposition already clears implicitly (bypass-approval permission, a live
   * ignoreWarnings) are omitted, matching the asserts' synchronous override —
   * but the overridden conflicts must still be logged, matching the asserts'
   * override logging. On the REST publish path this plus the handler's
   * evaluatePublishGates IS the guard enforcement; deferred/internal paths keep
   * their asserts.
   */
  collectPublishGates?(
    context: Context,
    entity: TSnapshot,
    revision: Revision,
    desiredState: Record<string, unknown>,
  ): Promise<PublishGate[]>;

  /**
   * Called on the no-op merge path (publish with no net entity change — a
   * genuine no-op or a retry after a partial apply). `applyChanges` is skipped
   * there, so side effects it would have run (e.g. cascading a schema change to
   * descendants that never ran because the first attempt failed mid-way) must
   * be replayed here. Invoked BEFORE the merge is claimed so a failure leaves
   * the draft open and retryable. Must be idempotent.
   */
  beforeNoOpMerge?(
    context: Context,
    entity: TSnapshot,
    revision: Revision,
  ): Promise<void>;

  // ---------- Scheduled publish (optional overrides; sensible defaults) ----------

  /**
   * Whether the caller may ARM a date-based scheduled publish. When absent,
   * defaults to the `scheduled-revisions` premium feature plus publish
   * authority (`canPublishRevision`) — so every revisioned entity supports
   * scheduling out of the box. Override only to narrow it.
   */
  canSchedulePublish?(context: Context, snapshot: TSnapshot): boolean;

  /**
   * Publish authority over the entity — gates publishing, canceling a pending
   * schedule, and taking one over. Defaults to `canUpdate` when absent.
   * Override when publish authority differs from edit (e.g. an
   * environment-scoped publish permission).
   */
  canPublishRevision?(context: Context, snapshot: TSnapshot): boolean;

  /**
   * Throws when the LIVE entity can't accept a future publish (e.g. a locked
   * config) — checked when ARMING a schedule so it's rejected up front instead
   * of failing at every poller tick. Canceling is never gated.
   */
  assertSchedulable?(context: Context, entity: TSnapshot): Promise<void> | void;

  /**
   * Capture arm-time acknowledgments when a deferred publish is armed (scheduled
   * or auto-publish-on-approval). Returns a per-guard map of keys to snapshot on
   * the revision and re-check at merge time; throws (e.g. SoftWarningError) when
   * the armer must acknowledge a condition first. The config/constant adapters use
   * this for the experiment / config-lock / schema-break guards; adapters without
   * an arm-time precondition omit it.
   *
   * `proposedChanges` are the revision's staged ops, so an adapter can skip the
   * precondition for a change that can't trigger it (e.g. a metadata-only config
   * revision that rewrites no served value).
   */
  captureArmAcknowledgment?(
    context: Context,
    entity: TSnapshot,
    proposedChanges: unknown,
  ): Promise<ArmAcknowledgments | undefined>;
}
