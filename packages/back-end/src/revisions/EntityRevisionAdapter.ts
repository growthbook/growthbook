import { isEqual } from "lodash";
import type { Revision } from "shared/enterprise";
import {
  NO_ENVIRONMENT_BINDING,
  RevisionAction,
  RevisionModel,
} from "shared/permissions";
import type { PublishFootprint } from "back-end/src/revisions/revisionPublishEnvironments";
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
 * The five per-action permission hooks, which differ across adapters only in
 * how the snapshot yields projects and environments.
 */
export function revisionActionHooks<TSnapshot extends Record<string, unknown>>({
  model,
  projectsOf,
  envsOf,
}: {
  model: RevisionModel;
  projectsOf: (snapshot: TSnapshot) => string[];
  envsOf?: (context: Context, snapshot: TSnapshot) => string[];
}): Required<
  Pick<
    EntityRevisionAdapter<TSnapshot>,
    | "canManageDrafts"
    | "canReview"
    | "canPublishRevision"
    | "canRevert"
    | "canDeleteEntity"
  >
> {
  const scoped = (
    action: RevisionAction,
    context: Context,
    snapshot: TSnapshot,
  ) =>
    context.permissions.canRevisionAction(
      model,
      action,
      { projects: projectsOf(snapshot) },
      envsOf ? envsOf(context, snapshot) : NO_ENVIRONMENT_BINDING,
    );
  return {
    canManageDrafts: (context, snapshot) =>
      context.permissions.canRevisionAction(model, "draft", {
        projects: projectsOf(snapshot),
      }),
    canReview: (context, snapshot) =>
      context.permissions.canRevisionAction(model, "review", {
        projects: projectsOf(snapshot),
      }),
    canPublishRevision: (context, snapshot) =>
      scoped("publish", context, snapshot),
    canRevert: (context, snapshot) => scoped("revert", context, snapshot),
    canDeleteEntity: (context, snapshot) => scoped("delete", context, snapshot),
  };
}

/**
 * What an apply actually persisted: the top-level keys it wrote (post
 * updatable-filter and post-normalization) and the doc the write RETURNED.
 *
 * `written` is the ownership baseline compensation needs, taken from the write
 * itself rather than a re-read — a re-read after failure can observe a
 * concurrent writer and mistake their values for this apply's own. `null` only
 * when the apply threw before its entity write, in which case there is nothing
 * of ours to put back.
 */
export type ApplyChangesResult = {
  persistedKeys: string[];
  written: Record<string, unknown> | null;
  /**
   * Writes the apply made to OTHER entities on this landing's behalf — a Config's
   * descendant cascade — each with its own pre-image. Compensation restores these
   * AFTER the root: ancestor normalization is unconditional on a revert, so a
   * descendant restored while the root still declares the field is stripped straight
   * back, reporting success. Re-running the cascade cannot undo it either, which is
   * why the pre-images are recorded rather than recomputed.
   */
  cascade?: {
    before: Record<string, unknown> & { id: string };
    written: Record<string, unknown>;
    /** `dateUpdated` the cascade write left, for callers re-anchoring a CAS baseline. */
    stamp?: Date | null;
  }[];
};

// Adapter interface that each entity type must implement to participate in the
// revision system. All saved-group-specific logic lives in the saved-group adapter;
// adding a new entity type requires only creating a new adapter and registering it.
//
// See revisions/adapters/saved-group.adapter.ts for the reference implementation.
export interface EntityRevisionAdapter<
  TSnapshot extends Record<string, unknown> = Record<string, unknown>,
> {
  /** Return the BaseModel for this entity type, used for loading the live entity. */
  getModel(context: Context): {
    getById(id: string): Promise<TSnapshot | null>;
    // Read-filtered batch fetch: what comes back is what the caller may READ,
    // which is how revision listings decide visibility from the live entity
    // rather than a snapshot that predates a project move. Projected to drop the
    // heavy value fields — listings ask for every target in a filtered scan, and
    // a read check only consults project scope.
    getReadScopesByIds(ids: string[]): Promise<TSnapshot[]>;
  } | null;

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

  // Lifecycle authority, each split out from `canUpdate` so a role can hold one
  // without full edit access. All default to `canUpdate` when not implemented.

  /** Create/edit/discard/rebase a revision and request review. */
  canManageDrafts?(context: Context, snapshot: TSnapshot): boolean;

  /** Approve / request changes / undo a verdict. */
  canReview?(context: Context, snapshot: TSnapshot): boolean;

  /** Restore a previously-published revision. */
  canRevert?(context: Context, snapshot: TSnapshot): boolean;

  /**
   * Archive/delete the ENTITY (the delete atom) — distinct from `canDelete`
   * above, which gates discarding a revision document and is bypass-tier.
   */
  canDeleteEntity?(context: Context, snapshot: TSnapshot): boolean;

  // The environment reach of a specific change set, layered ON TOP of
  // `canPublishRevision`, which cannot see the change. Omit when this entity type
  // has no environment dimension at all.
  //
  // Returns a tagged reach, never a bare list: `{scope:"environments"}` narrows,
  // `{scope:"unscoped"}` says the change has no environment dimension, and
  // `{scope:"everywhere"}` says it reaches all served environments without naming
  // them. Spelling the last two the same way — as an empty list — is what let an
  // archive flip pass every environment check vacuously.
  publishFootprint?(
    context: Context,
    snapshot: TSnapshot,
    proposedChanges: unknown,
  ): PublishFootprint;

  // ---------- Approval flow ----------

  /** Whether this org requires approval before a revision can be merged. */
  isApprovalRequired(context: Context): boolean;

  // Whether approval is required for this *specific* revision. Defaults to
  // `isApprovalRequired(context)` for adapters that don't care about the
  // revision's contents — override when an entity-type's review settings
  // gate on what changed (e.g. saved-group's `requireMetadataReview`, which
  // lets metadata-only revisions skip review).
  isApprovalRequiredForRevision?(context: Context, revision: Revision): boolean;

  /** Whether the current user can bypass the approval requirement. */
  canBypassApproval(context: Context, snapshot: TSnapshot): boolean;

  // Whether an *approved* revision should reset to pending-review when its
  // proposed changes are subsequently modified. Defaults (when not implemented)
  // to the entity's approval-flow `resetReviewOnChange` toggle. Override when the
  // decision depends on what changed and/or the settings live elsewhere — e.g.
  // constants, which use the feature `requireReviews` model.
  shouldResetReviewOnChange?(context: Context, revision: Revision): boolean;

  // Whether auto-publish-on-approval may be armed for this entity. Defaults
  // (when not implemented) to the entity's approval-flow `autopublishOnApproval`
  // toggle. Override for entities whose review settings live elsewhere — e.g.
  // constants.
  isAutopublishOnApprovalEnabled?(
    context: Context,
    snapshot: TSnapshot,
  ): boolean;

  // ---------- Merge ----------

  // Persist the computed changes back to the live entity.
  //
  // `isRevert` lets adapters skip validations that would block restoring a
  // previously-published state.
  //
  // Returns the keys ACTUALLY persisted — what survived the updatable filter and any
  // adapter normalization (a config field stripped as ancestor-owned, say). Bulk
  // compensation restores
  // ONLY these keys, so a field the write dropped is never rolled back over a
  // concurrent writer's value. Single-entity callers ignore the return.
  /**
   * Re-run whatever `applyChanges` cascades to, after a compensation restored
   * the fields named in `restoredKeys`. Restoring the entity's own document does
   * not un-touch dependents a partially failed cascade already wrote — Config
   * descendants reconciled against a root that has since been put back. Invoked
   * by the shared restore, so every compensation path (single, bulk, direct)
   * repairs the same way. Omit when nothing cascades.
   */
  afterRestorePreImage?(
    context: Context,
    entity: TSnapshot,
    restoredKeys: string[],
  ): Promise<void>;

  applyChanges(
    context: Context,
    entity: TSnapshot,
    changes: Record<string, unknown>,
    // `guarded` conditions the entity write on `entity` still being current, so a
    // landing that lost a race fails (CasConflictError) instead of overwriting the
    // winner. Every landing passes it; compensation and self-heal writes do not,
    // because they re-read first and mean to write over what they found.
    options?: {
      isRevert?: boolean;
      guarded?: boolean;
      // Called the moment the ENTITY write lands, before any cascade — so a
      // caller learns what was persisted even when a later step throws and the
      // return value never arrives. Returning the result is not enough: a Config
      // whose root write succeeds and whose descendant cascade then fails is
      // exactly the case compensation needs, and it exits by throwing.
      onPersisted?: (result: ApplyChangesResult) => void;
    },
  ): Promise<ApplyChangesResult>;

  // Validate what a merge would apply BEFORE the merge is claimed: throwing here leaves
  // the revision open and editable, instead of stranding it "merged" and relying on a
  // post-merge reopen. Runs on every internal publish path — bypass skips approval, not
  // validation. Optional: adapters without publish-time invariants can omit it.
  assertPublishable?(
    context: Context,
    entity: TSnapshot,
    desiredState: Record<string, unknown>,
    revision: Revision,
    // `deferred` = this is a background/armed merge (scheduled publish or
    // auto-publish-on-approval), whose overrides are the arm-time snapshot on the
    // revision — NOT a synchronous manual publish (where a live ignoreWarnings/
    // bypass applies).
    // `hooksAlreadyRan`: the caller already evaluated this entity's custom hooks
    // (the REST publish handlers collect them as gates), so the assert must not
    // execute them a second time — sandboxed hooks can be slow and are not
    // guaranteed idempotent.
    options?: {
      isRevert?: boolean;
      deferred?: boolean;
      hooksAlreadyRan?: boolean;
    },
  ): Promise<void>;

  // Non-throwing view of the same guards the sequential asserts enforce, so a blocked
  // REST publish reports EVERY gate — and the flag that clears it — in one 422 rather
  // than one per round trip. Gates the caller's authority or request disposition already
  // clears are omitted, matching the asserts' synchronous override —
  // but the overridden conflicts must still be logged, matching the asserts'
  // override logging. On the REST publish path this plus the handler's
  // evaluatePublishGates IS the guard enforcement; deferred/internal paths keep
  // their asserts.
  collectPublishGates?(
    context: Context,
    entity: TSnapshot,
    revision: Revision,
    desiredState: Record<string, unknown>,
  ): Promise<PublishGate[]>;

  // Called on the no-op merge path (publish with no net entity change — a
  // genuine no-op or a retry after a partial apply). `applyChanges` is skipped
  // there, so side effects it would have run (e.g. cascading a schema change to
  // descendants that never ran because the first attempt failed mid-way) must
  // be replayed here. Invoked BEFORE the merge is claimed so a failure leaves
  // the draft open and retryable. Must be idempotent.
  beforeNoOpMerge?(
    context: Context,
    entity: TSnapshot,
    revision: Revision,
  ): Promise<void>;

  // ---------- Scheduled publish (optional overrides; sensible defaults) ----------

  // Whether the caller may ARM a date-based scheduled publish. When absent,
  // defaults to the `scheduled-revisions` premium feature plus publish
  // authority (`canPublishRevision`) — so every revisioned entity supports
  // scheduling out of the box. Override only to narrow it.
  canSchedulePublish?(context: Context, snapshot: TSnapshot): boolean;

  // Publish authority over the entity — gates publishing, canceling a pending
  // schedule, and taking one over. Defaults to `canUpdate` when absent.
  // Override when publish authority differs from edit (e.g. an
  // environment-scoped publish permission).
  canPublishRevision?(context: Context, snapshot: TSnapshot): boolean;

  /**
   * Throws when the LIVE entity can't accept a future publish (e.g. a locked
   * config) — checked when ARMING a schedule so it's rejected up front instead
   * of failing at every poller tick. Canceling is never gated.
   */
  assertSchedulable?(context: Context, entity: TSnapshot): Promise<void> | void;

  // Acknowledgments captured when a deferred publish is armed: a per-guard map of keys
  // to snapshot on the revision and re-check at merge time, throwing when the armer must
  // acknowledge first. Omitted by adapters with no arm-time precondition.
  //
  // `proposedChanges` are the revision's staged ops, so an adapter can skip the
  // precondition for a change that can't trigger it (e.g. a metadata-only config
  // revision that rewrites no served value).
  captureArmAcknowledgment?(
    context: Context,
    entity: TSnapshot,
    proposedChanges: unknown,
  ): Promise<ArmAcknowledgments | undefined>;
}
