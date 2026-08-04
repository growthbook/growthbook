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
} from "shared/enterprise";
import uniqid from "uniqid";
import type { Context } from "back-end/src/models/BaseModel";
import { getAdapter } from "back-end/src/revisions";
import {
  buildMergeDesiredState,
  isRevisionDiverged,
} from "back-end/src/revisions/util";
import { liveMatchesRevisionBase } from "back-end/src/revisions/revisionAuthority";
import {
  holdsMoveDestination,
  isMove,
} from "back-end/src/revisions/moveAuthority";
import { getRevisionWebhookAdapter } from "back-end/src/events/revisionWebhookAdapters";
import { getContextForUserIdInOrg } from "back-end/src/services/organizations";
import {
  BadRequestError,
  ConflictError,
  MergeConflictError,
  TerminalPublishError,
  isTerminalPublishError,
  getErrorMessage,
} from "back-end/src/util/errors";
import { isPureRevertRevision } from "back-end/src/revisions/revertPurity";
import {
  isArchiveTransition,
  isPureArchiveRevision,
  proposedArchivedValue,
} from "back-end/src/revisions/archiveTransition";
import { decideScheduledPublishOutcome } from "back-end/src/revisions/publishFailurePolicy";
import { logger } from "back-end/src/util/logger";

// Actions the generic revision controller dispatches to adapter hooks.
export type RevisionActionKind = "draft" | "review" | "revert" | "publish";

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
  const fn =
    action === "draft"
      ? adapter.canManageDrafts
      : action === "review"
        ? adapter.canReview
        : action === "revert"
          ? adapter.canRevert
          : adapter.canPublishRevision;
  return (fn ?? adapter.canUpdate)(context, snapshot);
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

/**
 * May this caller touch a revision of this entity at all — the model-layer
 * backstop behind the controller's per-action gate.
 *
 * It is the union of the four actions on purpose. A revision document is
 * written by drafting, reviewing, reverting and publishing alike, and the model
 * can't see which one it is; anything narrower would refuse writes the
 * controller had already allowed.
 */
export function canTouchRevision(
  type: RevisionTargetType,
  context: Context,
  snapshot: Record<string, unknown>,
): boolean {
  return (["draft", "review", "revert", "publish"] as const).some((action) =>
    canDoRevisionAction(type, action, context, snapshot),
  );
}

/**
 * Publish authority, or a narrow atom over a revision that only does what that
 * atom covers: revert authority for one that only restores a previously-
 * published state, delete authority for one that only archives. Purity is
 * checked only on the fallbacks, so publishers are unaffected and pay no extra
 * revision load. Mirrors `assertCanPublishFeatureRevision`.
 */
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
  // arm below shares it — the archive checks included, since an archive lands in
  // the environments the entity serves just as a publish does.
  const footprint =
    adapter.publishFootprint?.(
      context,
      snapshot,
      revision.target.proposedChanges,
    ) ?? [];

  // Archiving is delete-class wherever the transition lands. Note this needs the
  // entity's delete atom from the permission table — adapter.canDelete gates
  // deleting a revision document (the entity's bypass-approval permission),
  // not the entity.
  if (
    isArchiveTransition({
      proposed: proposedArchivedValue(revision.target.proposedChanges),
      current: snapshot.archived as boolean | undefined,
    }) &&
    !context.permissions.canRevisionAction(
      revision.target.type,
      "delete",
      snapshot,
      footprint,
    )
  ) {
    context.permissions.throwPermissionError();
  }

  const footprintOk = (action: "publish" | "revert"): boolean =>
    !footprint.length ||
    context.permissions.canRevisionAction(
      revision.target.type,
      action,
      snapshot,
      footprint,
    );

  if (
    (adapter.canPublishRevision ?? adapter.canUpdate)(context, snapshot) &&
    footprintOk("publish")
  ) {
    return;
  }

  const canRevert =
    (adapter.canRevert ?? adapter.canUpdate)(context, snapshot) &&
    footprintOk("revert");
  if (canRevert && (await isPureRevertRevision(context, revision))) return;

  // Staging an archive as a draft must not require an atom that landing it in one
  // step doesn't: archiving is delete-class, so delete authority alone lands a
  // revision that archives and changes nothing else. Approval is a separate gate.
  if (
    context.permissions.canRevisionAction(
      revision.target.type,
      "delete",
      snapshot,
      footprint,
    ) &&
    isPureArchiveRevision({
      proposedChanges: revision.target.proposedChanges,
      current: snapshot.archived as boolean | undefined,
    })
  ) {
    return;
  }

  context.permissions.throwPermissionError();
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

  if (revision.authorId === context.userId) {
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
  { bypass, deferred }: { bypass?: boolean; deferred?: boolean } = {},
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

  // The publish-authority check above covers the live (source) entity. If the
  // revision moves the entity to a different project, also require update
  // permission on the destination — publishing a project move must not land
  // where the caller lacks access. `ownershipChanged` covers the scalar
  // `project` (configs/constants) and the `projects[]` array (saved groups),
  // including clears-to-global, so an ordinary publish (no move) isn't blocked.
  const destination = { ...entity, ...desiredState };
  // Edit authority in the destination is not enough on its own: the change is
  // LANDING there, so it also takes publish authority over the environments it
  // reaches. The footprint comes from the PRE-patch entity — it is derived by
  // diffing the snapshot against the proposed changes, so the already-patched
  // destination would compare the change against itself and report nothing.
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
  });

  // Claimed the merge but never applied it: apply now, nothing to re-claim. In
  // approval-required orgs the gate above demands bypass ("merged" isn't
  // "approved") — deliberate; recovery stays one publish call, by an admin.
  if (alreadyMerged) {
    // `hasChanges` alone does NOT identify a stranded merge — every superseded
    // revision differs from current live state, so on its own it would let an
    // old merged revision be reapplied over newer content. Two further marks are
    // required, and neither is sufficient alone:
    //
    //  - the live entity still matches this revision's own base, and
    //  - this is still the NEWEST merged revision for the target.
    //
    // The second is what closes the replay window: content can return to an old
    // revision's base (publish away and back again), but only via a later merge,
    // which makes that revision no longer the newest. A merge that genuinely
    // never landed is always the newest one, because nothing published after it.
    const latestMerged = await context.models.revisions.getLatestMergedByTarget(
      revision.target.type,
      revision.target.id,
    );
    const strandedMerge =
      hasChanges &&
      latestMerged?.id === revision.id &&
      liveMatchesRevisionBase({
        baseSnapshot: revision.target.snapshot as Record<string, unknown>,
        liveSnapshot: entity as Record<string, unknown>,
        updatableFields,
      });
    if (!strandedMerge) {
      throw new BadRequestError(
        `Cannot publish a revision with status "${revision.status}"`,
      );
    }
    // The merge was already claimed, so there is nothing left to claim in the
    // merge itself — hence the claim here, guarded on `dateUpdated`. Two operators
    // retrying at once would otherwise both apply and both dispatch. The loser's
    // guard fails, it re-reads, sees the marker entry, and aborts.
    const claimed = await context.models.revisions.updateWithCas(
      revision.id,
      ["dateUpdated"],
      (existing) =>
        (existing.activityLog ?? []).some((e) => e.action === "merge-recovered")
          ? null
          : {
              activityLog: [
                ...(existing.activityLog ?? []),
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
      const fresh = await adapter
        .getModel(context)
        ?.getById(revision.target.id);
      const landed =
        !!fresh &&
        Object.keys(desiredState).every(
          (key) =>
            !updatableFields.has(key) ||
            isEqual(desiredState[key], (fresh as Record<string, unknown>)[key]),
        );
      if (!landed) {
        throw new BadRequestError(
          "This merge is being recovered by another request. Retry in a moment.",
        );
      }
      return revision;
    }

    try {
      await adapter.applyChanges(context, entity, desiredState, {
        isRevert: !!revision.revertedFrom,
      });
    } catch (e) {
      // The marker is a claim, not a record of success. Leaving it behind on a
      // failed apply would make every later retry see it and return without
      // applying anything — stranding the revision permanently, which is worse
      // than the double-dispatch the claim exists to prevent.
      await context.models.revisions
        .updateWithCas(
          revision.id,
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
            `Failed to release the recovery claim on revision ${revision.id}; a retry will no-op until the merge-recovered entry is removed`,
          );
        });
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

  // No net change vs the live entity: either a genuine no-op or a retry after a
  // partial publish (changes applied, merge failed). Close it out as merged
  // rather than erroring, so stranded drafts self-heal. Mirrors
  // postSavedGroupRevisionPublish.
  if (!hasChanges) {
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
    await adapter.applyChanges(context, entity, desiredState, {
      isRevert: !!revision.revertedFrom,
    });
  } catch (e) {
    // Couldn't apply after claiming the merge — roll back to the pre-merge
    // state so the revision isn't stranded "merged" with the live entity
    // unchanged. Restores status AND any schedule `merge` scrubbed, so a
    // fire-time failure holds for the poller's next tick instead of silently
    // killing the schedule. A retry then re-runs the full publish (and the
    // no-op self-heal path above if it was partially applied). Best-effort:
    // surface the original error regardless.
    try {
      // Don't undo someone else's success: while this apply was failing, another
      // request may have recovered the same claimed merge and landed it. The
      // recovery marker is the proof, so leave the revision merged in that case.
      const current = await context.models.revisions.getById(merged.id);
      const recoveredElsewhere = (current?.activityLog ?? []).some(
        (e) => e.action === "merge-recovered",
      );
      if (recoveredElsewhere) {
        throw e;
      }
      const restored = await context.models.revisions.reopenAfterFailedApply(
        merged.id,
        context.userId,
        revision,
      );
      if (!restored) {
        await context.models.revisions.reopen(merged.id, context.userId);
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

/**
 * Poller entry point: publish a due scheduled revision with the arming user's
 * authority. Re-checks the due gate and governance (approval, conflicts, rebase,
 * sibling locks all live in publishRevision); on any failure records the attempt
 * and holds so the poller retries next tick.
 */
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
