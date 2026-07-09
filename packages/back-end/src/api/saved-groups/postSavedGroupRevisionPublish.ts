import { isEqual } from "lodash";
import {
  checkMergeConflicts,
  normalizeProposedChanges,
} from "shared/enterprise";
import { postSavedGroupRevisionPublishValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import {
  BadRequestError,
  ConflictError,
  MergeConflictError,
  NotFoundError,
} from "back-end/src/util/errors";
import { getAdapter } from "back-end/src/revisions";
import {
  buildMergeDesiredState,
  isRevisionDiverged,
} from "back-end/src/revisions/util";
import { dispatchSavedGroupRevisionEvent } from "back-end/src/services/savedGroupRevisionEvents";
import { loadRevisionByVersion } from "./validations";
import { toApiSavedGroupRevision } from "./toApiSavedGroupRevision";

export const postSavedGroupRevisionPublish = createApiRequestHandler(
  postSavedGroupRevisionPublishValidator,
)(async (req) => {
  const savedGroup = await req.context.models.savedGroups.getById(
    req.params.savedGroupId,
  );
  if (!savedGroup) {
    throw new NotFoundError("Could not find saved group");
  }

  const revision = await loadRevisionByVersion(
    req.context,
    savedGroup.id,
    req.params.version,
  );

  if (revision.status === "merged" || revision.status === "discarded") {
    throw new BadRequestError(
      `Cannot publish a revision with status "${revision.status}"`,
    );
  }

  const adapter = getAdapter("saved-group");

  // Re-check edit permission against the LIVE entity (not just the snapshot).
  // A `projects` move encoded in the proposed changes shouldn't be able to
  // launder write access — the caller still needs `canUpdateSavedGroup` on
  // the existing entity, plus the bypass permission below if review is open.
  if (!adapter.canUpdate(req.context, savedGroup as Record<string, unknown>)) {
    req.context.permissions.throwPermissionError();
  }

  // Per-revision approval gate: saved-group adapter has a metadata-only
  // shortcut, so honour `isApprovalRequiredForRevision` when available.
  const approvalRequired = adapter.isApprovalRequiredForRevision
    ? adapter.isApprovalRequiredForRevision(req.context, revision)
    : adapter.isApprovalRequired(req.context);

  // Bypass via either the org-wide `restApiBypassesReviews` flag or per-user
  // bypass permission. Mirrors postFeatureRevisionPublish.ts.
  const canBypass =
    !!req.organization.settings?.restApiBypassesReviews ||
    adapter.canBypassApproval(
      req.context,
      savedGroup as Record<string, unknown>,
    );

  if (approvalRequired && revision.status !== "approved" && !canBypass) {
    throw new BadRequestError(
      `This revision requires approval before publishing (status: "${revision.status}"). ` +
        "Enable 'REST API always bypasses approval requirements' in organization settings, " +
        "or use a role/token that grants bypassApprovalChecks on this saved group's projects.",
    );
  }

  const isBypass = approvalRequired && revision.status !== "approved";

  // Build the desired final state by layering proposed changes on top of LIVE,
  // not the snapshot — this preserves any out-of-band writes to fields the
  // revision didn't propose to change. See `buildMergeDesiredState`.
  const desiredState = buildMergeDesiredState(
    savedGroup as unknown as Record<string, unknown>,
    revision.target.snapshot as Record<string, unknown>,
    revision.target.proposedChanges,
    adapter.getUpdatableFields(),
  );

  // The live check above covers the source projects. If the revision moves the
  // group to different projects, also require update permission on the
  // destination.
  if (
    !adapter.canUpdate(req.context, {
      ...(savedGroup as unknown as Record<string, unknown>),
      ...desiredState,
    })
  ) {
    req.context.permissions.throwPermissionError();
  }

  // Pre-merge conflict guard so we don't let a revision land on top of out-of
  // -band edits to the same field — caller must rebase first.
  const conflictResult = checkMergeConflicts(
    revision.target.snapshot as Record<string, unknown>,
    savedGroup as unknown as Record<string, unknown>,
    normalizeProposedChanges(revision.target.proposedChanges),
  );
  if (!conflictResult.success) {
    throw new MergeConflictError(
      "Merge conflicts exist — rebase before publishing",
      conflictResult.conflicts,
    );
  }

  const updatableFields = adapter.getUpdatableFields();

  // Governance friction (parity with features): when the org enforces same-base
  // merges, a revision created against a snapshot that no longer matches the
  // live saved group must be rebased first. `mergeNow` is the explicit "merge
  // anyway" opt-in but only takes effect for bypass-approval callers; otherwise
  // it's ignored and the revision must be rebased. Bypass callers stay exempt.
  if (req.organization.settings?.requireRebaseBeforePublish) {
    const forceMerge = !!req.body.mergeNow && canBypass;
    if (!forceMerge) {
      const diverged = isRevisionDiverged(
        adapter,
        revision.target.snapshot as Record<string, unknown>,
        savedGroup as unknown as Record<string, unknown>,
      );
      if (diverged && !canBypass) {
        throw new ConflictError(
          "This revision was created against an older version of the saved group. " +
            'Rebase the revision first. ("mergeNow": true bypasses this only with bypass-approval permission.)',
        );
      }
    }
  }
  const hasChanges = Object.keys(desiredState).some((key) => {
    if (!updatableFields.has(key)) return false;
    return !isEqual(
      desiredState[key],
      (savedGroup as unknown as Record<string, unknown>)[key],
    );
  });

  // No diff between the revision's desired state and the live entity. This is
  // either a genuine no-op publish, OR a recovery retry after a partial failure
  // where a previous publish ran `applyChanges` but then failed before `merge`
  // landed — leaving the entity updated and this revision stranded as a draft.
  // In both cases there's nothing to write to the entity, so just finish
  // merging the revision. This closes the partial-failure window: the stranded
  // draft self-heals on retry instead of being permanently un-publishable, and
  // we skip a redundant entity write (and its no-op audit entry).
  if (!hasChanges) {
    const merged = await req.context.models.revisions.merge(
      revision.id,
      req.context.userId,
      { bypass: isBypass },
    );
    await dispatchSavedGroupRevisionEvent(req.context, merged, {
      type: merged.revertedFrom ? "reverted" : "published",
    });
    return {
      revision: await toApiSavedGroupRevision(merged, req.context),
    };
  }

  // Claim the merge BEFORE applying to the live entity. `merge` is CAS-guarded,
  // so a concurrent discard either already lost (merge throws, nothing applied)
  // or will lose (its `close` CAS-fails). This closes the window where a discard
  // landing between applyChanges and merge would orphan a half-applied change on
  // the live group.
  const merged = await req.context.models.revisions.merge(
    revision.id,
    req.context.userId,
    { bypass: isBypass },
  );

  try {
    await adapter.applyChanges(
      req.context,
      savedGroup as unknown as Record<string, unknown>,
      desiredState,
      { isRevert: !!revision.revertedFrom },
    );
  } catch (e) {
    // Couldn't apply after claiming the merge — reopen so the revision isn't
    // stranded "merged" with the live group unchanged; a retry re-runs the
    // publish (and the no-op self-heal path above if it was partially applied).
    try {
      await req.context.models.revisions.reopen(merged.id, req.context.userId);
    } catch {
      // ignore — surface the original applyChanges error
    }
    throw e;
  }

  await dispatchSavedGroupRevisionEvent(req.context, merged, {
    type: merged.revertedFrom ? "reverted" : "published",
  });

  return {
    revision: await toApiSavedGroupRevision(merged, req.context),
  };
});
