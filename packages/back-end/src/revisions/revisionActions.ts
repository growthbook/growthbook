import { PermissionError } from "shared/util";
import { isEqual } from "lodash";
import {
  Revision,
  RevisionTargetType,
  checkMergeConflicts,
  normalizeProposedChanges,
  isUserBlockedFromApproving,
  isAutopublishOnApprovalEnabled,
  isScheduledPublishPending,
  isScheduledPublishDue,
  ReviewDecision,
  JsonPatchOperation,
} from "shared/enterprise";
import { ACTIVE_DRAFT_STATUSES } from "shared/validators";
import uniqid from "uniqid";
import type { Context } from "back-end/src/models/BaseModel";
import { getAdapter } from "back-end/src/revisions";
import {
  buildMergeDesiredState,
  isRevisionDiverged,
} from "back-end/src/revisions/util";
import {
  canAdvanceRevision,
  canRebaseRevision,
  isRevisionAuthor,
  liveMatchesRevisionBase,
  reviewAuthorityOnRow,
} from "back-end/src/revisions/revisionAuthority";
import {
  holdsMoveDestination,
  isMove,
} from "back-end/src/revisions/moveAuthority";
import { getRevisionWebhookAdapter } from "back-end/src/events/revisionWebhookAdapters";
import { assertCanLandRevision } from "back-end/src/revisions/landAuthority";
import {
  MergeConflictError,
  BadRequestError,
  ConflictError,
  TerminalPublishError,
  isTerminalPublishError,
  getErrorMessage,
} from "back-end/src/util/errors";
import { getContextForUserIdInOrg } from "back-end/src/services/organizations";
import { isPureRevertRevision } from "back-end/src/revisions/revertPurity";
import {
  isArchiveTransition,
  isPureArchiveRevision,
  proposedArchivedValue,
} from "back-end/src/revisions/archiveTransition";
import { decideScheduledPublishOutcome } from "back-end/src/revisions/publishFailurePolicy";
import { logger } from "back-end/src/util/logger";
import {
  assertLandingBaseline,
  liveMatchesDesiredState,
  runGuardedWrite,
  withBufferedPayloadRefreshes,
} from "back-end/src/revisions/landingSequence";

// Actions the generic revision controller dispatches to adapter hooks.
export type RevisionActionKind =
  | "draft"
  | "review"
  | "revert"
  | "publish"
  | "delete";

/**
 * Authority for one revision action on one entity. The per-action hooks are
 * optional; an adapter that doesn't split them falls back to `canUpdate`.
 */
export function canDoRevisionAction(
  type: RevisionTargetType,
  action: RevisionActionKind,
  context: Context,
  snapshot: Record<string, unknown>,
): boolean {
  const adapter = getAdapter(type);
  // Exhaustive on purpose — no default arm. A chain that fell through to the
  // publish check is how "delete" was added to the backstop's union and quietly
  // asked about publishing instead; a new action must fail the build rather than
  // inherit someone else's authority.
  const hookFor = (a: RevisionActionKind) => {
    switch (a) {
      case "draft":
        return adapter.canManageDrafts;
      case "review":
        return adapter.canReview;
      case "revert":
        return adapter.canRevert;
      case "publish":
        return adapter.canPublishRevision;
      case "delete":
        // The ENTITY delete atom. `canDelete` governs discarding revision
        // DOCUMENTS and is bypass-tier, which is the wrong authority here.
        return adapter.canDeleteEntity;
      default: {
        // A new action reaches here and fails the build. The arms above may
        // legitimately return undefined (an optional hook falls back to
        // canUpdate), so the return type alone cannot enforce this.
        const unhandled: never = a;
        return unhandled;
      }
    }
  };
  return (hookFor(action) ?? adapter.canUpdate)(context, snapshot);
}

// Commenting is participation, not authority over the entity: the addComments
// atom is what gates it everywhere else (feature and experiment discussions), so
// honour it here too, alongside draft and review authority. Shared by the
// internal controller and the REST submit-review handlers so the two agree.
export function canCommentOnRevision(
  type: RevisionTargetType,
  context: Context,
  snapshot: Record<string, unknown>,
): boolean {
  const projects =
    (snapshot.projects as string[] | undefined) ??
    (snapshot.project ? [snapshot.project as string] : []);
  return (
    context.permissions.canAddComment(projects) ||
    canDoRevisionAction(type, "draft", context, snapshot) ||
    canDoRevisionAction(type, "review", context, snapshot)
  );
}

// May this caller touch a revision of this entity at all — the model-layer
// backstop behind the controller's per-action gate.
//
// It is the union of every action on purpose. A revision document is written by
// drafting, reviewing, reverting, publishing and archiving alike, and the model
// can't see which one it is; anything narrower refuses writes the controller had
// already allowed. Delete belongs in the union because archiving is delete-class:
// a delete-only role may stage and land a revision that only archives, and
// omitting it made that pass the handler and then fail here.
export function canTouchRevision(
  type: RevisionTargetType,
  context: Context,
  snapshot: Record<string, unknown>,
): boolean {
  return (["draft", "review", "revert", "publish", "delete"] as const).some(
    (action) => canDoRevisionAction(type, action, context, snapshot),
  );
}

// Landing authority for a JSON-patch revision: derives the footprint and the
// purity proofs, then defers to the shared rule. Purity is only computed on the
// fallback arms, so publishers pay no extra revision load.
// How long a stranded-merge recovery claim is honoured. Applying takes seconds; a
// marker older than this means the claiming process died before releasing it.
const MERGE_RECOVERY_LEASE_MS = 10 * 60 * 1000;

// Drop the recovery claim. The marker is a claim, not a record of success:
// leaving it behind makes every later retry see it and return without applying
// anything, stranding the revision permanently — worse than the double-dispatch
// the claim exists to prevent.
async function releaseRecoveryClaim(
  context: Context,
  revisionId: string,
): Promise<void> {
  await context.models.revisions
    .updateWithCas(
      revisionId,
      ["dateUpdated"],
      (existing) => ({
        activityLog: (existing.activityLog ?? []).filter(
          (entry) => entry.action !== "merge-recovered",
        ),
      }),
      { dangerouslyBypassCanUpdate: true },
    )
    .catch((releaseErr) => {
      logger.error(
        releaseErr,
        `Failed to release the recovery claim on revision ${revisionId}; a retry will no-op until the merge-recovered entry is removed`,
      );
    });
}
// Re-publish a merge that was claimed but never applied — a crash between the
// merge claim and the entity write. Returns null when this is not one.
//
// Identifying it takes all three marks, and no two suffice: content still differs
// from live, the live entity still matches this revision's base, AND this is still
// the NEWEST merged revision. The third is what closes the replay window — content
// can be walked back to an old base, but only via a later merge, which forfeits
// "newest".
async function recoverStrandedMerge({
  context,
  revision,
  entity,
  desiredState,
  hasChanges,
  updatableFields,
}: {
  context: Context;
  revision: Revision;
  entity: Record<string, unknown>;
  desiredState: Record<string, unknown>;
  hasChanges: boolean;
  updatableFields: ReadonlySet<string>;
}): Promise<Revision | null> {
  const adapter = getAdapter(revision.target.type);
  // Nothing left to apply is the common case — a retry of an already-published
  // revision. But a multi-step apply can die BETWEEN its entity write and its
  // cascade, and the entity write alone makes hasChanges false — so a retry
  // would land here, see nothing to recover, and the cascade would never
  // replay. beforeNoOpMerge is each adapter's idempotent replay of exactly
  // those side effects (a config's descendant reconcile); run it before
  // declining, scoped to revisions this entity actually merged.
  if (!hasChanges) {
    const latest = await context.models.revisions.getLatestMergedByTarget(
      revision.target.type,
      revision.target.id,
    );
    if (latest?.id === revision.id) {
      await adapter.beforeNoOpMerge?.(context, entity, revision);
    }
    return null;
  }

  const latestMerged = await context.models.revisions.getLatestMergedByTarget(
    revision.target.type,
    revision.target.id,
  );
  const strandedMerge =
    latestMerged?.id === revision.id &&
    liveMatchesRevisionBase({
      baseSnapshot: revision.target.snapshot as Record<string, unknown>,
      liveSnapshot: entity as Record<string, unknown>,
      updatableFields,
    });
  if (!strandedMerge) return null;
  // The merge was already claimed, so there is nothing left to claim in the
  // merge itself — hence the claim here, guarded on `dateUpdated`. Two operators
  // retrying at once would otherwise both apply and both dispatch. The loser's
  // guard fails, it re-reads, sees the marker entry, and aborts.
  // The marker is a LEASE, not a permanent record. It exists to stop two operators
  // applying and dispatching at once; a recovery that actually succeeded needs no
  // marker, because live then matches the desired state and `hasChanges` keeps this
  // path from being entered at all. So a marker older than the lease belonged to a
  // process that died between claiming and releasing, and is reclaimable —
  // otherwise a termination there locked recovery out permanently.
  const leaseCutoff = new Date(Date.now() - MERGE_RECOVERY_LEASE_MS);
  const claimed = await context.models.revisions.updateWithCas(
    revision.id,
    ["dateUpdated"],
    (existing) =>
      (existing.activityLog ?? []).some(
        (e) =>
          e.action === "merge-recovered" &&
          new Date(e.dateCreated) > leaseCutoff,
      )
        ? null
        : {
            activityLog: [
              ...(existing.activityLog ?? []).filter(
                (e) => e.action !== "merge-recovered",
              ),
              {
                id: uniqid("rvl_"),
                userId: context.userId || "",
                action: "merge-recovered" as const,
                description: "Re-published a merge that never landed",
                dateCreated: new Date(),
              },
            ],
          },
    // The revision is merged, and canUpdate refuses merged revisions to keep
    // history immutable — but this claim IS the recovery of that merge, and
    // the caller's publish authority was checked above.
    { dangerouslyBypassCanUpdate: true },
  );
  if (!claimed) {
    // Someone else holds the claim. Only report success once their apply has
    // actually landed — otherwise this returns "published" while the winner is
    // still mid-apply and the live entity is unchanged. Re-read the entity and
    // require it to match the desired state; if it doesn't yet, the caller
    // should retry rather than believe the change is live.
    const fresh = await adapter.getModel(context)?.getById(revision.target.id);
    if (
      !liveMatchesDesiredState({
        live: (fresh as Record<string, unknown> | null) ?? null,
        desiredState,
        updatableFields,
      })
    ) {
      throw new BadRequestError(
        "This merge is being recovered by another request. Retry in a moment.",
      );
    }
    return revision;
  }

  // The claim guards the revision, not the entity, and the checks above ran
  // before it: in between, another landing can have merged and applied, which
  // would make this apply write older state over newer. Re-verify both facts now
  // that the claim is held — still the newest merged revision, and live still
  // matching the base this recovery applies onto.
  try {
    await assertLandingBaseline({
      context,
      entityType: revision.target.type,
      entityId: revision.target.id,
      baselineDateUpdated:
        (entity as { dateUpdated?: Date }).dateUpdated ?? null,
      requireLatestMergedId: revision.id,
    });
  } catch (e) {
    await releaseRecoveryClaim(context, revision.id);
    throw e;
  }

  try {
    // Guarded like every other landing: the recheck above proves the baseline held
    // a moment ago, this proves it still holds at the write. Recovered state is by
    // definition older, so losing the race must refuse rather than overwrite.
    await runGuardedWrite(revision.target.type, revision.target.id, () =>
      adapter.applyChanges(context, entity, desiredState, {
        isRevert: !!revision.revertedFrom,
        guarded: true,
      }),
    );
  } catch (e) {
    // The marker is a claim, not a record of success. Leaving it behind on a
    // failed apply would make every later retry see it and return without
    // applying anything — stranding the revision permanently, which is worse
    // than the double-dispatch the claim exists to prevent.
    await releaseRecoveryClaim(context, revision.id);
    throw e;
  }
  // The failed attempt never dispatched; this apply is when the change lands.
  // Dispatch and return the CLAIMED revision — `revision` predates the claim,
  // so the webhook payload and the response would disagree with a refetch.
  await getRevisionWebhookAdapter(revision.target.type)?.dispatch(
    context,
    claimed,
    { type: claimed.revertedFrom ? "reverted" : "published" },
  );
  return claimed;
}

/**
 * Boolean form of `assertCanPublishRevision`, for callers that must decide
 * feasibility rather than refuse outright. Delegates rather than reimplements
 * so the preflight and the publish can never disagree about what's allowed.
 */
export async function canPublishRevisionChange(
  context: Context,
  revision: Revision,
  entity: object,
): Promise<boolean> {
  try {
    await assertCanPublishRevision(context, revision, entity);
    return true;
  } catch (e) {
    if (e instanceof PermissionError) return false;
    throw e;
  }
}

export async function assertCanPublishRevision(
  context: Context,
  revision: Revision,
  // Any entity object — only its project ownership is read, via the adapter.
  entity: object,
): Promise<void> {
  const adapter = getAdapter(revision.target.type);
  const snapshot = entity as Record<string, unknown>;

  // Change-aware environment footprint, when the adapter can compute one. Every
  // arm shares it — the archive check included, since an archive lands in the
  // environments the entity serves just as a publish does.
  const footprint =
    adapter.publishFootprint?.(
      context,
      snapshot,
      revision.target.proposedChanges,
    ) ?? [];

  await assertCanLandRevision({
    context,
    holds: (action) =>
      context.permissions.canRevisionAction(
        revision.target.type,
        action,
        snapshot,
        footprint,
      ) &&
      // The adapter's own entity-level gate, which can be narrower than the atom
      // (a Config's edit rule, for instance). Only publish and revert have one;
      // delete answers to the permission table alone, because adapter.canDelete
      // gates deleting a revision DOCUMENT, not the entity.
      (action === "delete" ||
        (action === "publish"
          ? (adapter.canPublishRevision ?? adapter.canUpdate)(context, snapshot)
          : (adapter.canRevert ?? adapter.canUpdate)(context, snapshot))),
    archives: isArchiveTransition({
      proposed: proposedArchivedValue(revision.target.proposedChanges),
      current: snapshot.archived as boolean | undefined,
    }),
    isPureRevert: () => isPureRevertRevision(context, revision),
    isPureArchive: () =>
      isPureArchiveRevision({
        proposedChanges: revision.target.proposedChanges,
        current: snapshot.archived as boolean | undefined,
      }),
  });
}

export async function approveRevision(
  context: Context,
  revision: Revision,
  entity: Record<string, unknown>,
  comment?: string,
): Promise<Revision> {
  const adapter = getAdapter(revision.target.type);
  const canReview = adapter.canReview ?? adapter.canUpdate;
  if (!canReview(context, entity as Record<string, unknown>)) {
    context.permissions.throwPermissionError();
  }

  if (isRevisionAuthor(revision.authorId, context.userId)) {
    throw new BadRequestError("Cannot approve your own revision");
  }

  if (
    context.hasPremiumFeature("require-approvals") &&
    isUserBlockedFromApproving({
      settings: context.org.settings,
      entityType: revision.target.type,
      revision,
      userId: context.userId,
    })
  ) {
    throw new BadRequestError(
      "You contributed to this revision and cannot approve it.",
    );
  }

  if (
    !["pending-review", "changes-requested", "approved"].includes(
      revision.status,
    )
  ) {
    throw new BadRequestError(
      `Can only approve when review has been requested (status is "${revision.status}")`,
    );
  }

  const updated = await context.models.revisions.addReview(
    revision.id,
    context.userId,
    "approve",
    comment ?? "",
    reviewAuthorityOnRow(context),
  );

  await getRevisionWebhookAdapter(updated.target.type)?.dispatch(
    context,
    updated,
    {
      type: "reviewed",
      decision: "approve",
      userId: context.userId,
      ...(comment ? { comment } : {}),
    },
  );

  return updated;
}

export async function publishRevision(
  context: Context,
  revision: Revision,
  entity: Record<string, unknown>,
  {
    bypass,
    deferred,
    // Set when the caller already ran the entity's validation hooks as publish
    // gates, so `assertPublishable` must not execute the sandboxed hook twice.
    skipHooks,
  }: { bypass?: boolean; deferred?: boolean; skipHooks?: boolean } = {},
): Promise<Revision> {
  // One deduped SDK refresh per landing, flushed whether it lands or compensates
  // — a multi-step apply otherwise broadcasts its mid-landing mix.
  return withBufferedPayloadRefreshes(context, "revision-publish", () =>
    publishRevisionInner(context, revision, entity, {
      bypass,
      deferred,
      skipHooks,
    }),
  );
}

async function publishRevisionInner(
  context: Context,
  revision: Revision,
  entity: Record<string, unknown>,
  {
    bypass,
    deferred,
    skipHooks,
  }: { bypass?: boolean; deferred?: boolean; skipHooks?: boolean } = {},
): Promise<Revision> {
  const adapter = getAdapter(revision.target.type);

  await assertCanPublishRevision(context, revision, entity);

  if (revision.status === "discarded") {
    throw new BadRequestError(
      `Cannot publish a revision with status "${revision.status}"`,
    );
  }
  // The merge is claimed BEFORE the entity write, so a failed write plus a
  // failed reopen strands a merge the entity never received. Publishing is the
  // only way back — the rejection moves below, where `hasChanges` can tell a
  // stranded merge from a completed one.
  const alreadyMerged = revision.status === "merged";

  const approvalRequired = adapter.isApprovalRequiredForRevision
    ? adapter.isApprovalRequiredForRevision(context, revision)
    : adapter.isApprovalRequired(context);
  const canBypass = bypass || adapter.canBypassApproval(context, entity);

  if (approvalRequired && revision.status !== "approved" && !canBypass) {
    throw new BadRequestError(
      "The revision must be approved before it can be published",
    );
  }

  const isBypass = approvalRequired && revision.status !== "approved";

  const conflictResult = checkMergeConflicts(
    revision.target.snapshot as Record<string, unknown>,
    entity,
    normalizeProposedChanges(revision.target.proposedChanges),
    adapter.getUpdatableFields(),
  );
  if (!conflictResult.success) {
    throw new MergeConflictError(
      "Merge conflicts exist — rebase before publishing",
      conflictResult.conflicts,
    );
  }

  // requireRebaseBeforePublish: a diverged revision must rebase first unless the
  // caller can bypass. Gating here covers every internal publish path.
  if (context.org.settings?.requireRebaseBeforePublish && !canBypass) {
    const diverged = isRevisionDiverged(
      adapter,
      revision.target.snapshot as Record<string, unknown>,
      entity,
    );
    if (diverged) {
      throw new ConflictError(
        "This revision was created against an older version of the entity. " +
          "Rebase the revision first.",
      );
    }
  }

  // Another draft's committed "lock other drafts" schedule blocks this publish.
  // Excludes this revision by id, so the locking revision can still fire itself.
  if (
    await context.models.revisions.hasPublishLockingScheduledSibling(
      revision.target,
      revision.id,
    )
  ) {
    throw new BadRequestError(
      "Another draft of this entity has a scheduled publish that locks other drafts. Cancel that schedule to publish this revision.",
    );
  }

  const desiredState = buildMergeDesiredState(
    entity,
    revision.target.snapshot as Record<string, unknown>,
    revision.target.proposedChanges,
    adapter.getUpdatableFields(),
  );

  // A move needs edit rights on the destination AND publish over the environments
  // it reaches. The footprint comes from the PRE-patch entity: it is derived by
  // diffing the snapshot against the proposed changes, so the patched destination
  // would compare the change against itself and report nothing.
  const destination = { ...entity, ...desiredState };
  if (
    isMove(entity, destination) &&
    (!adapter.canUpdate(context, destination) ||
      !holdsMoveDestination({
        permissions: context.permissions,
        model: revision.target.type,
        action: "publish",
        existing: entity,
        proposed: destination,
        environments:
          adapter.publishFootprint?.(
            context,
            entity,
            revision.target.proposedChanges,
          ) ?? [],
      }))
  ) {
    context.permissions.throwPermissionError();
  }

  const updatableFields = adapter.getUpdatableFields();
  const hasChanges = Object.keys(desiredState).some((key) => {
    if (!updatableFields.has(key)) return false;
    return !isEqual(desiredState[key], entity[key]);
  });

  // Validate BEFORE claiming the merge so a publish that fails validation (e.g. a
  // config value violating a cross-field rule) errors without ever marking the
  // revision merged — it stays open and editable. A bypass/admin-override publish
  // skips approval, not validation. Runs even for the no-op branch below —
  // publishing (including a no-op merge) is the gated action, and e.g. a locked
  // config must not have its latest-merged pointer advanced past the pin.
  await adapter.assertPublishable?.(context, entity, desiredState, revision, {
    isRevert: !!revision.revertedFrom,
    deferred: !!deferred,
    // Forward it: the REST publish handlers evaluate this entity's hooks as gates
    // before calling in, so the assert must not run them a second time.
    hooksAlreadyRan: !!skipHooks,
    ...(skipHooks ? { skipHooks: true } : {}),
  });

  // Claimed the merge but never applied it: apply now, nothing to re-claim. In
  // approval-required orgs the gate above demands bypass ("merged" isn't
  // "approved") — deliberate; recovery stays one publish call, by an admin.
  if (alreadyMerged) {
    const recovered = await recoverStrandedMerge({
      context,
      revision,
      entity,
      desiredState,
      hasChanges,
      updatableFields,
    });
    if (!recovered) {
      throw new BadRequestError(
        `Cannot publish a revision with status "${revision.status}"`,
      );
    }
    return recovered;
  }

  // No net change vs the live entity: either a genuine no-op or a retry after a
  // partial publish (changes applied, merge failed). Close it out as merged
  // rather than erroring, so stranded drafts self-heal. Mirrors
  // postSavedGroupRevisionPublish.
  if (!hasChanges) {
    // "No changes" was decided against a read that is stale by now, and this
    // branch performs no guarded entity write to catch drift — so re-verify the
    // baseline here, or a concurrent change landing after planning would leave
    // merged history claiming live already matched this revision when it no
    // longer does. A conflict is the same retryable 409 as any lost landing.
    await assertLandingBaseline({
      context,
      entityType: revision.target.type,
      entityId: revision.target.id,
      baselineDateUpdated:
        (entity as { dateUpdated?: Date }).dateUpdated ?? null,
    });
    // Runs before the merge so a failure leaves the draft open and retryable.
    await adapter.beforeNoOpMerge?.(context, entity, revision);
    const merged = await context.models.revisions.merge(
      revision.id,
      context.userId,
      { bypass: isBypass },
    );
    await getRevisionWebhookAdapter(merged.target.type)?.dispatch(
      context,
      merged,
      { type: merged.revertedFrom ? "reverted" : "published" },
    );
    return merged;
  }

  // Claim the merge BEFORE touching the live entity. `merge` is CAS-guarded, so
  // a concurrent discard either lost (status already moved → merge throws here,
  // nothing applied) or will lose (its `close` CAS-fails once we've merged).
  // This closes the window where a discard landing between applyChanges and
  // merge would orphan a half-applied change on the live entity.
  const merged = await context.models.revisions.merge(
    revision.id,
    context.userId,
    { bypass: isBypass },
  );

  try {
    // The claim guards the REVISION; this guards the ENTITY. Without it, two
    // drafts of the same entity could both pass their own claim and then apply in
    // either order, leaving live state contradicting the newest merged revision.
    // A lost race surfaces as the same retryable conflict every other landing
    // reports, and the compensation below reopens this revision.
    await runGuardedWrite(revision.target.type, revision.target.id, () =>
      adapter.applyChanges(context, entity, desiredState, {
        isRevert: !!revision.revertedFrom,
        guarded: true,
      }),
    );
  } catch (e) {
    // Couldn't apply after claiming the merge — roll back to the pre-merge
    // state so the revision isn't stranded "merged" with the live entity
    // unchanged. Restores status AND any schedule `merge` scrubbed, so a
    // fire-time failure holds for the poller's next tick instead of silently
    // killing the schedule. A retry then re-runs the full publish (and the
    // no-op self-heal path above if it was partially applied). Best-effort:
    // surface the original error regardless.
    try {
      // Guarded on the merge we just wrote, so the read and the undo are one step:
      // if anything touched the revision in between — a concurrent recovery
      // landing it — this no-ops instead of reopening a revision that is now live.
      // No unguarded fallback, for the same reason.
      const restored = await context.models.revisions.reopenAfterFailedApply(
        merged.id,
        context.userId,
        revision,
        merged.dateUpdated,
      );
      if (!restored) {
        logger.warn(
          { revisionId: merged.id },
          "left merged after a failed apply: the revision changed underneath the compensation, so reopening could undo a concurrent recovery",
        );
      }
    } catch {
      // ignore — the original applyChanges error is the one that matters
    }
    throw e;
  }

  await getRevisionWebhookAdapter(merged.target.type)?.dispatch(
    context,
    merged,
    { type: merged.revertedFrom ? "reverted" : "published" },
  );

  return merged;
}

export async function canEnableAutoPublishOnApproval(
  context: Context,
  revision: Revision,
  entity: Record<string, unknown>,
): Promise<boolean> {
  const entityType = revision.target.type;
  if (!context.hasPremiumFeature("require-approvals")) return false;
  const adapter = getAdapter(entityType);
  // The adapter may override how autopublish-on-approval is determined
  // (constants key off the feature `requireReviews` model). Default to the
  // entity's approval-flow toggle.
  const enabled = adapter.isAutopublishOnApprovalEnabled
    ? adapter.isAutopublishOnApprovalEnabled(context, entity)
    : isAutopublishOnApprovalEnabled(
        context.org.settings,
        entityType,
        (entity as { project?: string }).project,
      );
  if (!enabled) return false;
  // Arming auto-publish-on-approval is a publish-authority concern, and it takes
  // the SAME authority the eventual fire will: the adapter check alone cannot
  // see the change set, so a caller limited to dev could arm a
  // production-touching override and have it record fine, then fail on publish.
  return canPublishRevisionChange(context, revision, entity);
}

export async function maybeAutoPublishRevision(
  context: Context,
  revision: Revision,
  entity: Record<string, unknown>,
): Promise<Revision> {
  if (!revision.autoPublishOnApproval) return revision;
  if (revision.status !== "approved") return revision;

  // A future-dated schedule defers the publish to the poller — don't fire early
  // just because approval landed.
  if (isScheduledPublishPending(revision) && !isScheduledPublishDue(revision)) {
    return revision;
  }

  // Publish with the authority of whoever armed auto-publish; fall back to
  // the author for revisions armed before `autoPublishEnabledBy` existed.
  const enablerId = revision.autoPublishEnabledBy ?? revision.authorId;
  if (!enablerId) {
    logger.warn(
      { revisionId: revision.id },
      "auto-publish-on-approval skipped: no arming user or author; left approved",
    );
    // Returning quietly let "approve and publish" report success having only
    // approved. The approval itself stands — it happened — but the caller has to
    // learn the publish did not, or nobody goes back for it.
    throw new BadRequestError(
      "Approved, but the publish did not run: this draft has no arming user to publish as. Publish it directly.",
    );
  }

  // Resolved BEFORE the try: the catch below deliberately swallows publish
  // failures to leave the draft approved for a manual publish, which would also
  // swallow this and let the caller believe the publish ran.
  const enablerContext = await getContextForUserIdInOrg(context.org, enablerId);
  if (!enablerContext) {
    logger.warn(
      { revisionId: revision.id, enablerId },
      "auto-publish-on-approval skipped: enabling user could not be resolved; left approved",
    );
    throw new BadRequestError(
      "Approved, but the publish did not run: the user who armed auto-publish is no longer a member of this organization. Publish it directly.",
    );
  }

  try {
    // Deferred: the guard override was acknowledged at arm time (fingerprint on
    // the revision), not by whoever triggered this approval.
    return await publishRevision(enablerContext, revision, entity, {
      deferred: true,
    });
  } catch (e) {
    logger.error(
      e,
      `auto-publish-on-approval failed for revision ${revision.id}; left approved for manual publish`,
    );
    // Terminal failures notify a human and disarm (this path has no poller retry
    // loop); transient failures stay approved for a manual publish, no webhook.
    if (isTerminalPublishError(e)) {
      // Disarm so a later trigger (re-approval, undo, rebase) doesn't re-run the
      // doomed publish and re-fire the webhook; also clears the stale fingerprint.
      let disarmed = revision;
      try {
        disarmed = await context.models.revisions.setAutoPublishOnApproval(
          revision.id,
          context.userId,
          false,
        );
      } catch {
        // best-effort — still fire the webhook below
      }
      await getRevisionWebhookAdapter(revision.target.type)?.dispatch(
        context,
        disarmed,
        {
          type: "publishFailed",
          reason: getErrorMessage(e),
          terminal: true,
          attempts: 1,
        },
      );
      return disarmed;
    }
    return revision;
  }
}

// Record a failed scheduled-publish attempt and decide what happens next: retry
// after a backoff, or give up (park the draft + fire `revision.publishFailed`).
// Terminal failures give up on the first attempt; transient ones retry up to the
// cap. See publishFailurePolicy for the decision logic.
async function handleScheduledPublishFailure(
  context: Context,
  revision: Revision,
  error: unknown,
): Promise<void> {
  const message = getErrorMessage(error);
  const attempts = await context.models.revisions.recordScheduledPublishFailure(
    revision.id,
    message,
  );
  const outcome = decideScheduledPublishOutcome({
    error,
    attempts,
    now: new Date(),
  });

  if (outcome.action === "retry") {
    await context.models.revisions.setScheduledPublishNextAttempt(
      revision.id,
      outcome.nextAttemptAt,
    );
    logger.info(
      {
        revisionId: revision.id,
        attempts,
        nextAttemptAt: outcome.nextAttemptAt,
      },
      `Scheduled publish held (retry after backoff): ${message}`,
    );
    return;
  }

  // Give up: stop the poller retrying and notify a human.
  const terminal = outcome.classification === "terminal";
  await context.models.revisions.parkScheduledPublish(revision.id);
  logger.error(
    { revisionId: revision.id, attempts, terminal },
    `Scheduled publish gave up (${terminal ? "terminal failure" : "max attempts reached"}): ${message}`,
  );
  await getRevisionWebhookAdapter(revision.target.type)?.dispatch(
    context,
    revision,
    { type: "publishFailed", reason: message, terminal, attempts },
  );
}

// Poller entry point: publish a due scheduled revision with the arming user's
// authority. Re-checks the due gate and governance (approval, conflicts, rebase,
// sibling locks all live in publishRevision); on any failure records the attempt
// and holds so the poller retries next tick.
export async function maybePublishScheduledRevision(
  context: Context,
  revision: Revision,
  entity: Record<string, unknown>,
): Promise<Revision> {
  if (!isScheduledPublishDue(revision)) return revision;

  // Respect the backoff window between transient retries.
  if (
    revision.scheduledPublishNextAttemptAt &&
    revision.scheduledPublishNextAttemptAt > new Date()
  ) {
    return revision;
  }

  const enablerId = revision.autoPublishEnabledBy ?? revision.authorId;
  if (!enablerId) {
    // No user to ever publish as — terminal, don't retry.
    await handleScheduledPublishFailure(
      context,
      revision,
      new TerminalPublishError("No arming user or author to publish with"),
    );
    return revision;
  }

  try {
    const enablerContext = await getContextForUserIdInOrg(
      context.org,
      enablerId,
    );
    if (!enablerContext) {
      // Transient: the user may resolve on a later tick.
      await handleScheduledPublishFailure(
        context,
        revision,
        new Error("Arming user could not be resolved"),
      );
      return revision;
    }

    // Admin bypass-approval is only honored if the armer STILL holds bypass at
    // fire time (a lapsed admin can't force a non-bypass schedule through).
    const adapter = getAdapter(revision.target.type);
    const bypass =
      !!revision.scheduledPublishBypassApproval &&
      adapter.canBypassApproval(enablerContext, entity);

    return await publishRevision(enablerContext, revision, entity, {
      bypass,
      deferred: true,
    });
  } catch (e) {
    await handleScheduledPublishFailure(context, revision, e);
    return revision;
  }
}

// Discard an open revision. The author may always discard their own draft;
// anyone else needs authoring rights on the entity.
export async function discardEntityRevision({
  context,
  entityType,
  entity,
  revision,
  reason,
}: {
  context: Context;
  entityType: RevisionTargetType;
  entity: { project?: string; projects?: string[] };
  revision: Revision;
  reason?: string;
}): Promise<Revision> {
  if (revision.status === "merged" || revision.status === "discarded") {
    throw new BadRequestError(
      `Cannot discard a revision with status "${revision.status}"`,
    );
  }

  // Authors can always discard their own draft; anyone else needs authoring
  // rights on the entity.
  if (
    !isRevisionAuthor(revision.authorId, context.userId) &&
    !context.permissions.canRevisionAction(entityType, "draft", entity)
  ) {
    context.permissions.throwPermissionError();
  }

  const closed = await context.models.revisions.close(
    revision.id,
    context.userId,
    reason,
  );
  await getRevisionWebhookAdapter(entityType)?.dispatch(context, closed, {
    type: "discarded",
  });
  return closed;
}

// Submit a revision for review, arming auto-publish when asked for. Arming takes
// the same change-aware authority the eventual publish will.
export async function requestRevisionReview({
  context,
  entityType,
  entity,
  revision,
  autoPublishOnApproval,
}: {
  context: Context;
  entityType: RevisionTargetType;
  entity: Record<string, unknown>;
  revision: Revision;
  autoPublishOnApproval?: boolean;
}): Promise<Revision> {
  // canAdvanceRevision, not a bare draft check: advancing a draft is not authoring
  // content, so a narrow atom covers one that does only what that atom covers — a
  // revert-only author could otherwise create a pure-revert draft and never submit
  // it for review.
  if (!(await canAdvanceRevision(context, revision))) {
    context.permissions.throwPermissionError();
  }

  // Re-submitting a changes-requested revision is allowed (→ pending-review).
  if (revision.status !== "draft" && revision.status !== "changes-requested") {
    throw new BadRequestError(
      `Can only request review on a draft or changes-requested revision (status is "${revision.status}")`,
    );
  }

  const enableAutoPublish =
    !!autoPublishOnApproval &&
    (await canEnableAutoPublishOnApproval(context, revision, entity));

  // Snapshot the acknowledged conflict keys per guard (throws if arming over live
  // conflicts without ignoreWarnings/bypass), via the adapter so every guard is
  // captured uniformly.
  const armAcknowledgments = enableAutoPublish
    ? await getAdapter(entityType).captureArmAcknowledgment?.(
        context,
        entity,
        revision.target.proposedChanges,
      )
    : undefined;

  const updated = await context.models.revisions.submitForReview(
    revision.id,
    context.userId,
    { autoPublishOnApproval: enableAutoPublish, armAcknowledgments },
  );
  await getRevisionWebhookAdapter(entityType)?.dispatch(context, updated, {
    type: "reviewRequested",
  });
  return updated;
}

// Record a review, and auto-publish if approving armed it.
//
// Authority splits by decision: a verdict takes review authority over the entity;
// a plain comment is participation and answers to the revision's own snapshot,
// whose project may predate a move.
export async function submitRevisionReview({
  context,
  entityType,
  entity,
  revision,
  decision,
  comment,
  skipAutoPublish,
}: {
  context: Context;
  entityType: RevisionTargetType;
  entity: Record<string, unknown> & { project?: string; projects?: string[] };
  revision: Revision;
  decision: ReviewDecision;
  comment?: string;
  skipAutoPublish?: boolean;
}): Promise<{ revision: Revision; autoPublished: boolean }> {
  const isComment = decision === "comment";

  if (
    !(isComment
      ? canCommentOnRevision(
          entityType,
          context,
          revision.target.snapshot as Record<string, unknown>,
        )
      : context.permissions.canRevisionAction(entityType, "review", entity))
  ) {
    context.permissions.throwPermissionError();
  }

  // The author may comment on their own draft, but not rule on it.
  if (isRevisionAuthor(revision.authorId, context.userId) && !isComment) {
    throw new BadRequestError("Cannot submit a review on a draft you created");
  }

  // Contributors cannot approve what they helped write. `addReview` re-checks this
  // under its CAS against the row it writes; this is the early, clearer refusal.
  if (
    decision === "approve" &&
    isUserBlockedFromApproving({
      settings: context.org.settings,
      entityType,
      revision,
      userId: context.userId,
    })
  ) {
    throw new BadRequestError("You cannot approve a draft you contributed to.");
  }

  if (
    !isComment &&
    !["pending-review", "changes-requested", "approved"].includes(
      revision.status,
    )
  ) {
    throw new BadRequestError(
      `Can only submit a review when review has been requested (status is "${revision.status}")`,
    );
  }

  const updated = await context.models.revisions.addReview(
    revision.id,
    context.userId,
    decision,
    comment ?? "",
    reviewAuthorityOnRow(context),
  );

  await getRevisionWebhookAdapter(entityType)?.dispatch(context, updated, {
    type: "reviewed",
    decision,
    userId: context.userId,
    ...(comment ? { comment } : {}),
  });

  if (decision === "approve" && !skipAutoPublish) {
    const after = await maybeAutoPublishRevision(context, updated, entity);
    return { revision: after, autoPublished: after.status === "merged" };
  }
  return { revision: updated, autoPublished: false };
}

// Rebase a draft onto live state, resolving conflicts per the caller's strategies.
// Two behaviours the code alone won't tell you, both pinned by the tests in
// test/api/*-revision-rebase.test.ts: an unresolved conflict answers 409, and
// `union` orders live values first, then the draft's additions, deduped.
//
// The request schema validates which strategies an entity offers (Constants have no
// list, so no `union`); this only requires one per conflicting field.
export async function rebaseRevision({
  context,
  entityType,
  entity,
  revision,
  strategies,
  customValues,
}: {
  context: Context;
  entityType: RevisionTargetType;
  entity: Record<string, unknown>;
  revision: Revision;
  strategies: Record<string, "overwrite" | "discard" | "union">;
  customValues?: Record<string, unknown>;
}): Promise<Revision> {
  // The canonical list in shared, rather than any of the four per-entity
  // isDraftStatus copies (three agree; the feature one has its own notion).
  if (!(ACTIVE_DRAFT_STATUSES as readonly string[]).includes(revision.status)) {
    throw new BadRequestError(
      `Can only rebase active draft revisions (status is "${revision.status}")`,
    );
  }

  const adapter = getAdapter(entityType);
  const updatableFields = adapter.getUpdatableFields();
  const baseSnapshot = revision.target.snapshot as Record<string, unknown>;

  // Draft authority covers any rebase; a narrow atom covers one that pulls nothing
  // into a draft it could already advance, so a single-purpose role can satisfy
  // "rebase before publishing" without a way to sweep someone else's changes in.
  if (
    !(await canRebaseRevision({
      context,
      revision,
      baseSnapshot,
      liveSnapshot: entity,
      updatableFields,
    }))
  ) {
    context.permissions.throwPermissionError();
  }

  const existingOps = normalizeProposedChanges(revision.target.proposedChanges);
  const mergeResult = checkMergeConflicts(
    baseSnapshot,
    entity,
    existingOps,
    updatableFields,
  );
  const conflicts = mergeResult.conflicts || [];

  // Every conflicting field needs an explicit strategy: the operation is never
  // implicitly resolved.
  for (const conflict of conflicts) {
    const strategy = strategies[conflict.field];
    if (
      strategy !== "overwrite" &&
      strategy !== "discard" &&
      strategy !== "union"
    ) {
      throw new MergeConflictError(
        `Please resolve conflict for field: ${conflict.field}`,
        conflicts,
      );
    }
  }

  const conflictFields = new Set(conflicts.map((c) => c.field));
  const newOps: JsonPatchOperation[] = [];
  const seenFields = new Set<string>();
  // `null` is the clear signal here, not "no value": a resolution that carries an
  // explicit null must still emit an op, or clearing a field — a Config schema,
  // say — is silently dropped on rebase. Only an absent value means nothing to say.
  const carriesValue = (value: unknown) => value !== undefined;

  for (const op of existingOps) {
    const field = op.path.split("/")[1];
    if (!field || seenFields.has(field)) continue;
    seenFields.add(field);

    if (!conflictFields.has(field)) {
      // Revisions only ever produce replace/add (buildPatchOps). A remove/move/copy
      // would be dropped by the value comparison below, silently losing intent.
      if (op.op !== "replace" && op.op !== "add") {
        throw new Error(
          `Unsupported patch op "${op.op}" in ${entityType} revision rebase`,
        );
      }
      // Live already caught up to what the draft was proposing: nothing to say.
      if (!isEqual(op.value, entity[field])) newOps.push(op);
      continue;
    }

    const strategy = strategies[field];
    const conflict = conflicts.find((c) => c.field === field);
    if (!conflict) continue;

    if (strategy === "overwrite") {
      if (
        carriesValue(conflict.proposedValue) &&
        !isEqual(conflict.proposedValue, entity[field])
      ) {
        newOps.push({
          op: "replace",
          path: `/${field}`,
          value: conflict.proposedValue,
        });
      }
    } else if (strategy === "union") {
      // A caller-supplied resolution wins; otherwise dedup-concat live then
      // proposed. For non-arrays there is nothing to merge, so the draft's value
      // stands.
      const custom = customValues?.[field];
      let resolvedValue: unknown;
      if (custom !== undefined) {
        resolvedValue = custom;
      } else if (
        Array.isArray(conflict.liveValue) &&
        Array.isArray(conflict.proposedValue)
      ) {
        const seen = new Set<string>();
        const result: unknown[] = [];
        for (const item of [
          ...(conflict.liveValue as unknown[]),
          ...(conflict.proposedValue as unknown[]),
        ]) {
          const key =
            typeof item === "object" ? JSON.stringify(item) : String(item);
          if (!seen.has(key)) {
            seen.add(key);
            result.push(item);
          }
        }
        resolvedValue = result;
      } else {
        resolvedValue = conflict.proposedValue;
      }
      if (
        carriesValue(resolvedValue) &&
        !isEqual(resolvedValue, entity[field])
      ) {
        newOps.push({ op: "replace", path: `/${field}`, value: resolvedValue });
      }
    }
    // strategy === "discard" → drop the op, so the live value stands.
  }

  const updated = await context.models.revisions.rebase(
    revision.id,
    entity,
    newOps,
    context.userId,
  );
  await getRevisionWebhookAdapter(entityType)?.dispatch(context, updated, {
    type: "rebased",
  });
  return updated;
}
