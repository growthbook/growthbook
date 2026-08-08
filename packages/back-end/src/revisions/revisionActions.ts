import { PermissionError, proposedProjectScope } from "shared/util";
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
  REVIEW_CYCLE_STATUSES,
} from "shared/enterprise";
import { ACTIVE_DRAFT_STATUSES } from "shared/validators";
import uniqid from "uniqid";
import type { Context } from "back-end/src/models/BaseModel";
import {
  discardAuthorityOnRow,
  advanceAuthorityOnRow,
  canAdvanceRevision,
  canDiscardRevision,
  canRebaseRevision,
  mayBeRevisionAuthor,
  liveMatchesRevisionBase,
  reviewAuthorityOnRow,
} from "back-end/src/revisions/revisionAuthority";
import { getAdapter } from "back-end/src/revisions";
import type { ApplyChangesResult } from "back-end/src/revisions/EntityRevisionAdapter";
import { resolvePublishFootprint } from "back-end/src/revisions/revisionPublishEnvironments";
import {
  buildMergeDesiredState,
  isRevisionDiverged,
} from "back-end/src/revisions/util";
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
  assertLandingStillOwned,
  liveMatchesDesiredState,
  runGuardedWrite,
  tryRestoreEntityPreImage,
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
 * Authority for a verb that belongs to the REVISION rather than the live entity:
 * drafting, reviewing, commenting.
 *
 * Takes no scope argument, deliberately. A review belongs to the revision, whose
 * project a later move on the live entity does not change, so these are judged on
 * `target.snapshot` — always. The two bases have the same type, so a parameter here
 * is a standing invitation to pass the wrong one.
 *
 * Verbs that LAND on live keep the explicit scope via `canDoRevisionAction`.
 */
export function canRevisionOwnedAction(
  context: Context,
  revision: Pick<Revision, "target">,
  action: Extract<RevisionActionKind, "draft" | "review">,
): boolean {
  return canDoRevisionAction(
    revision.target.type,
    action,
    context,
    revision.target.snapshot as Record<string, unknown>,
  );
}

/**
 * Authority for one revision action on one entity. Per-action adapter hooks are
 * optional; an adapter that doesn't split them falls back to `canUpdate`.
 */
export function canDoRevisionAction(
  type: RevisionTargetType,
  action: RevisionActionKind,
  context: Context,
  // The entity this question is asked ABOUT. For publish/revert/delete that is the
  // LIVE entity, because that is where the change lands. For draft/review prefer
  // `canRevisionOwnedAction`, which cannot be given the wrong one.
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

// May this caller touch a revision of this entity AT ALL — the model-layer backstop
// behind the controller's per-action gate, so deliberately the union of every action:
// the model can't see which one is in play, and anything narrower refuses writes the
// controller already allowed. Delete is in the union because archiving is delete-class.
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
  // Only THIS claim. Dropping every `merge-recovered` entry released whoever held
  // the lease, not necessarily the caller: an attempt that outran the lease has
  // already been superseded by a reclaimer, and its failure path would then free
  // the reclaimer's live lease — letting a third worker apply and dispatch
  // alongside a recovery still in flight, which is exactly what the claim exists
  // to prevent.
  claimId: string,
): Promise<void> {
  await context.models.revisions
    .updateWithCas(
      revisionId,
      // `activityLog` too: both recovery writes REWRITE the log they read, so a
      // concurrent entry would be dropped. `dateUpdated` alone does not cover it —
      // several revision writes deliberately leave `dateUpdated` untouched.
      ["dateUpdated", "activityLog"],
      (existing) => ({
        activityLog: (existing.activityLog ?? []).filter(
          (entry) =>
            !(entry.action === "merge-recovered" && entry.id === claimId),
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
  // Nothing to apply is usually a retry of an already-published revision. But a
  // multi-step apply can die BETWEEN its entity write and its cascade, and the entity
  // write alone makes `hasChanges` false — so the cascade would never replay.
  // `beforeNoOpMerge` is each adapter's idempotent replay of those side effects.
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
  // The merge is already claimed, so recovery claims here instead, guarded on
  // `dateUpdated` — otherwise two operators retrying at once both apply and dispatch.
  // The marker is a LEASE. A recovery that succeeded needs no marker — live then matches
  // and `hasChanges` keeps this path unentered — so one older than the lease belongs to a
  // process that died mid-flight and is reclaimable, or a termination locks recovery out.
  const leaseCutoff = new Date(Date.now() - MERGE_RECOVERY_LEASE_MS);
  // Minted OUTSIDE the compute so it survives a CAS retry and so the release path
  // can name the entry this attempt actually wrote.
  const claimId = uniqid("rvl_");
  const claimed = await context.models.revisions.updateWithCas(
    revision.id,
    ["dateUpdated", "activityLog"],
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
                id: claimId,
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
    await releaseRecoveryClaim(context, revision.id, claimId);
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
    await releaseRecoveryClaim(context, revision.id, claimId);
    throw e;
  }
  // The failed attempt never dispatched; this apply is when the change lands.
  // Dispatch and return the CLAIMED revision — `revision` predates the claim,
  // so the webhook payload and the response would disagree with a refetch.
  // A recovered revert is still a publish, and owes both events for the same reason
  // the ordinary landing does — consumers mirroring the published lifecycle were
  // missing every recovered revert.
  const recoveredWebhooks = getRevisionWebhookAdapter(revision.target.type);
  await recoveredWebhooks?.dispatch(context, claimed, { type: "published" });
  if (claimed.revertedFrom) {
    await recoveredWebhooks?.dispatch(context, claimed, { type: "reverted" });
  }
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

  // Change-aware environment footprint, when the adapter can narrow to one, and
  // everywhere the entity serves when it cannot. Resolved centrally so an empty
  // narrowing can never reach the permission layer, where it reads as "allowed
  // everywhere" instead of "check everywhere".
  const footprint = resolvePublishFootprint(
    context,
    adapter.publishFootprint?.(
      context,
      snapshot,
      revision.target.proposedChanges,
    ),
    snapshot,
  );

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

  // A change that relocates the entity lands in the DESTINATION, and none of
  // the narrow-atom exemptions above cross a move — there is no revision there
  // to judge purity against. In the engine rather than per handler, so a
  // handler that forgets is not a bypass.
  if (
    !holdsMoveDestination({
      permissions: context.permissions,
      model: revision.target.type,
      action: "publish",
      existing: snapshot,
      proposed: {
        ...snapshot,
        ...proposedProjectScope(revision.target.proposedChanges),
      },
      environments: footprint,
    })
  ) {
    context.permissions.throwPermissionError();
  }
}

export async function approveRevision(
  context: Context,
  revision: Revision,
  entity: Record<string, unknown>,
  comment?: string,
): Promise<Revision> {
  const adapter = getAdapter(revision.target.type);
  const canReview = adapter.canReview ?? adapter.canUpdate;
  // On the revision's SNAPSHOT, like every other review check — the preflight that
  // calls this, `addReview`'s CAS, `reviewAuthorityOnRow`, and the REST twin. A
  // review belongs to the revision, whose project a later move on the live entity
  // does not change. Asking about live here undid the preflight's answer: the
  // caller was cleared to approve and then refused one call later.
  if (
    !canReview(context, revision.target.snapshot as Record<string, unknown>)
  ) {
    context.permissions.throwPermissionError();
  }

  if (mayBeRevisionAuthor(revision.authorId, context.userId)) {
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
    // The cycle THIS caller read — see addReview.
    revision.reviewCycle ?? 0,
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
  //
  // Bypassable, like the same rule on all three other publish paths — feature
  // single skips it under `bypassLockdown`, and both bulk adapters raise it as a
  // gate the approval-bypass permission clears. This path was the lone absolute
  // refusal, so an admin could clear a sibling's lock everywhere except here.
  if (
    !canBypass &&
    (await context.models.revisions.hasPublishLockingScheduledSibling(
      revision.target,
      revision.id,
    ))
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
        environments: resolvePublishFootprint(
          context,
          adapter.publishFootprint?.(
            context,
            entity,
            revision.target.proposedChanges,
          ),
          entity,
        ),
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
    const merged = await context.models.revisions.merge(
      revision.id,
      context.userId,
      {
        bypass: isBypass,
        // Pin the revision the caller AUTHORIZED: a draft edit landing between
        // the gate phase (hooks make it seconds wide) and this claim must lose
        // the race, not get its never-authorized ops recorded as merged. Same
        // pin bulk passes at its claim.
        expected: {
          status: revision.status,
          dateUpdated: revision.dateUpdated,
        },
      },
    );
    // "No changes" was decided against a now-stale read, and this branch has no guarded
    // write to catch drift — so verify AFTER the claim is held. Any change later than
    // the claim is simply later; drift unwinds the claim and returns a retryable 409.
    //
    // Inside the same protected span, after claim and baseline both hold — run before
    // them, its descendant writes outlived a failure that then reopened the draft.
    try {
      await assertLandingBaseline({
        context,
        entityType: revision.target.type,
        entityId: revision.target.id,
        baselineDateUpdated:
          (entity as { dateUpdated?: Date }).dateUpdated ?? null,
      });
      await adapter.beforeNoOpMerge?.(context, entity, revision);
    } catch (e) {
      const reopened = await context.models.revisions
        .reopenAfterFailedApply(
          merged.id,
          context.userId,
          revision,
          merged.dateUpdated,
        )
        .catch(() => null);
      if (!reopened) {
        logger.warn(
          { revisionId: merged.id },
          "no-op merge left merged after its post-claim baseline check failed: the revision changed underneath the compensation",
        );
      }
      throw e;
    }
    // A revert that lands is ALSO a publish, so it owes both — `reverted` names what
    // happened, `published` is the lifecycle event subscribers mirror state from.
    const revisionWebhooks = getRevisionWebhookAdapter(merged.target.type);
    await revisionWebhooks?.dispatch(context, merged, { type: "published" });
    if (merged.revertedFrom) {
      await revisionWebhooks?.dispatch(context, merged, { type: "reverted" });
    }
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
    {
      bypass: isBypass,
      // Same authorized-content pin as the no-op branch and bulk's claim.
      expected: { status: revision.status, dateUpdated: revision.dateUpdated },
    },
  );

  let applied: ApplyChangesResult | undefined;
  try {
    // Re-checked now that this landing has a place in the order — the same pair the
    // revert and recovery paths assert after THEIR claims, and the only one of the
    // three that was missing it.
    //
    // The entity CAS below cannot cover the second half. A revision that claims the
    // merge and then dies before writing leaves the entity untouched, so an OLDER
    // revision's baseline still matches, its guarded write passes, and it lands
    // older state under a newer merged revision that recorded something else. That
    // split is permanent: recovery of the newer revision refuses, correctly, because
    // the baseline it would apply onto has since changed. Requiring this revision to
    // still be the newest merged one is what makes the order it claimed real.
    //
    // Thrown before any entity write, so the compensation below sees `applied`
    // undefined, restores nothing, and cleanly reopens the draft for a retry.
    await assertLandingBaseline({
      context,
      entityType: revision.target.type,
      entityId: revision.target.id,
      baselineDateUpdated:
        (entity as { dateUpdated?: Date }).dateUpdated ?? null,
      requireLatestMergedId: merged.id,
    });

    // The claim guards the REVISION; this guards the ENTITY. Without it, two
    // drafts of the same entity could both pass their own claim and then apply in
    // either order, leaving live state contradicting the newest merged revision.
    // A lost race surfaces as the same retryable conflict every other landing
    // reports, and the compensation below reopens this revision.
    await runGuardedWrite(revision.target.type, revision.target.id, () =>
      adapter.applyChanges(context, entity, desiredState, {
        isRevert: !!revision.revertedFrom,
        guarded: true,
        // Learned at the write, not from the return value: a Config whose root
        // lands and whose cascade then throws never returns, and that is exactly
        // the case compensation below has to judge ownership for.
        onPersisted: (result) => {
          applied = result;
        },
      }),
    );

    // The post-write half of the order; the rationale lives on the helper.
    await assertLandingStillOwned({
      context,
      entityType: revision.target.type,
      entityId: revision.target.id,
      mergedId: merged.id,
      expectedDateUpdated:
        (applied?.written as { dateUpdated?: Date } | null | undefined)
          ?.dateUpdated ??
        (entity as { dateUpdated?: Date }).dateUpdated ??
        null,
    });
  } catch (e) {
    // Failed after claiming the merge. A lost race wrote NOTHING (restoring would undo
    // the winner); a partial apply — Config root written before its cascade failed —
    // leaves live changes a bare reopen would orphan. Only a clean restore may reopen.
    // Keyed on the absence of a REPORT, not the error class: a Config cascade raises
    // CasConflictError long after the root write reported, and the class alone read that
    // live change as having written nothing.
    const nothingReported = !applied || applied.written === undefined;
    // Ownership is judged against what the adapter PERSISTED, not the intent — adapters
    // normalize, so unnormalized `desiredState` misreads "ours" as "someone else's".
    // `undefined` means the apply never reported — it threw before its entity
    // write, so nothing of ours is live. `null` means it reported writing
    // nothing. Neither is a re-read: distinguishing them is why the callback
    // exists, and conflating them with `??` sent both down a guessing path.
    const written = nothingReported || !applied ? null : applied.written;
    // Nothing reported means the apply never reached its entity write (adapters
    // report from inside it), so there is nothing to restore and the revision may
    // be reopened cleanly — the same reading bulk takes.
    // ROOT FIRST, unconditionally, then descendants in cascade order. Ancestor
    // normalization is unconditional on a revert, so a descendant restored while the
    // root still declares the field is re-stripped AND reports success.
    const rootRestored =
      nothingReported || written === null
        ? true
        : await tryRestoreEntityPreImage({
            context,
            entityType: revision.target.type,
            preImage: entity as Record<string, unknown> & { id: string },
            persistedKeys: Object.keys(desiredState).filter((k) =>
              updatableFields.has(k),
            ),
            written,
          });
    let cascadeRestored = true;
    for (const write of applied?.cascade ?? []) {
      const ok = await tryRestoreEntityPreImage({
        context,
        entityType: revision.target.type,
        preImage: write.before,
        persistedKeys: Object.keys(write.written),
        written: write.written,
      });
      if (!ok) cascadeRestored = false;
    }
    const entityRestored = rootRestored && cascadeRestored;
    if (!entityRestored) {
      logger.error(
        { revisionId: merged.id },
        "left merged after a failed apply: the live entity could not be restored, so the merged revision stays as the record of the partial change",
      );
      throw e;
    }
    // Roll back to the pre-merge state so the revision isn't stranded "merged"
    // with the live entity unchanged. Restores status AND any schedule `merge`
    // scrubbed, so a fire-time failure holds for the poller's next tick instead
    // of silently killing the schedule. A retry then re-runs the full publish.
    // Best-effort: surface the original error regardless.
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

  // See above: a revert landing is also a publish and owes both events.
  const webhookAdapter = getRevisionWebhookAdapter(merged.target.type);
  await webhookAdapter?.dispatch(context, merged, { type: "published" });
  if (merged.revertedFrom) {
    await webhookAdapter?.dispatch(context, merged, { type: "reverted" });
  }

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

/**
 * Authority to DISARM auto-publish-on-approval.
 *
 * The publish half of `canEnableAutoPublishOnApproval`, and only that half. Arming
 * additionally requires the premium feature and the org's approval flow switched on
 * for this project — conditions that make sense as a precondition for taking on a
 * future publish, and strand an already-armed revision if they are asked again on
 * the way out: a lapsed licence or a flow turned off would leave the revision armed
 * with no way to stand it down.
 *
 * Same split the dated schedule already makes, where `canScheduleFeaturePublish`
 * gates arming and `canPublishFeatureRevision` gates cancelling.
 */
export async function canDisarmAutoPublishOnApproval(
  context: Context,
  revision: Revision,
  entity: Record<string, unknown>,
): Promise<boolean> {
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
    revision.scheduledPublishAt ?? null,
  );
  // Zero means the revision moved on — closed, or re-armed with a different
  // schedule — so this attempt is stale and must not report a failure for it.
  if (!attempts) return;
  const outcome = decideScheduledPublishOutcome({
    error,
    attempts,
    now: new Date(),
  });

  if (outcome.action === "retry") {
    await context.models.revisions.setScheduledPublishNextAttempt(
      revision.id,
      outcome.nextAttemptAt,
      revision.scheduledPublishAt ?? null,
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
  // A no-op park means the revision moved on — a concurrent publish succeeded, or the
  // schedule was replaced — so this attempt's failure is not this revision's outcome
  // and must not be announced as one.
  const parked = await context.models.revisions.parkScheduledPublish(
    revision.id,
    revision.scheduledPublishAt ?? null,
  );
  if (!parked) return;
  logger.error(
    { revisionId: revision.id, attempts, terminal },
    `Scheduled publish gave up (${terminal ? "terminal failure" : "max attempts reached"}): ${message}`,
  );
  // The PARKED revision, re-read. Parking clears the schedule and disarms
  // auto-publish, so the pre-image describes a revision still armed and still
  // scheduled — the opposite of what this event reports, and a subscriber
  // mirroring state from the payload would put the schedule back.
  const afterPark =
    (await context.models.revisions.getById(revision.id)) ?? revision;
  await getRevisionWebhookAdapter(revision.target.type)?.dispatch(
    context,
    afterPark,
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
  revision,
  reason,
}: {
  context: Context;
  entityType: RevisionTargetType;
  revision: Revision;
  reason?: string;
}): Promise<Revision> {
  if (revision.status === "merged" || revision.status === "discarded") {
    throw new BadRequestError(
      `Cannot discard a revision with status "${revision.status}"`,
    );
  }

  // Discarding is NARROWER than advancing: draft authority or authorship only.
  // Letting a narrow atom discard — a deleter over any pure-archive draft — meant a
  // delete-only role could throw away another author's work, including a draft
  // already in review. They can still publish it or leave it alone.
  if (!(await canDiscardRevision(context, revision))) {
    context.permissions.throwPermissionError();
  }

  const closed = await context.models.revisions.close(
    revision.id,
    context.userId,
    // Re-asked on the row each attempt: the check above ran against the project the
    // draft was in when it was read, and a rebase can move it.
    discardAuthorityOnRow(context),
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
    advanceAuthorityOnRow(context),
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

  // Both verbs judged on the REVISION's snapshot, not the live entity: a review
  // belongs to the revision, whose project may predate a move — the internal
  // route, the CAS re-check inside addReview, and the front-end prediction all
  // answer on the snapshot, and this was the one place still asking about live.
  if (
    !(isComment
      ? canCommentOnRevision(
          entityType,
          context,
          revision.target.snapshot as Record<string, unknown>,
        )
      : context.permissions.canRevisionAction(
          entityType,
          "review",
          revision.target.snapshot as Record<string, unknown>,
        ))
  ) {
    context.permissions.throwPermissionError();
  }

  // The author may comment on their own draft, but not rule on it.
  if (mayBeRevisionAuthor(revision.authorId, context.userId) && !isComment) {
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
    !(REVIEW_CYCLE_STATUSES as readonly string[]).includes(revision.status)
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
    // The cycle THIS caller read — see addReview.
    revision.reviewCycle ?? 0,
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
    advanceAuthorityOnRow(context),
  );
  await getRevisionWebhookAdapter(entityType)?.dispatch(context, updated, {
    type: "rebased",
  });
  return updated;
}
