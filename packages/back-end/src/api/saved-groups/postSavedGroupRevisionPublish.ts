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
  evaluatePublishGates,
  PublishBlockedError,
  PublishGate,
} from "back-end/src/revisions/publishGates";
import {
  buildMergeDesiredState,
  isRevisionDiverged,
} from "back-end/src/revisions/util";
import { dispatchSavedGroupRevisionEvent } from "back-end/src/services/savedGroupRevisionEvents";
import { collectSavedGroupArchiveDependentsGate } from "back-end/src/services/archiveDependentsGuard";
import { collectRevisionGovernanceGates } from "back-end/src/revisions/governanceGates";
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
  // Require publish authority against the LIVE entity before leaking any
  // revision state. Destination-project manage rights for a projects move are
  // checked separately below, only when the revision actually changes projects.
  if (
    !(adapter.canPublishRevision ?? adapter.canUpdate)(
      req.context,
      savedGroup as Record<string, unknown>,
    )
  ) {
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

  // Aggregate every publish gate up front so a blocked publish returns ONE
  // structured 422 naming each gate, the flag that clears it, and a callable
  // resolution route. Gates are assembled for every ACTIVE condition (whether
  // or not the caller can bypass it) so a successful publish can report the ones
  // that were bypassed. The sequential checks below stay in place as the
  // enforcement backstop.

  // Build the desired final state by layering proposed changes on top of LIVE,
  // not the snapshot — this preserves any out-of-band writes to fields the
  // revision didn't propose to change. See `buildMergeDesiredState`. Built up
  // front so the archive transition is known before gate assembly.
  const desiredState = buildMergeDesiredState(
    savedGroup as unknown as Record<string, unknown>,
    revision.target.snapshot as Record<string, unknown>,
    revision.target.proposedChanges,
    adapter.getUpdatableFields(),
  );

  const gates: PublishGate[] = [
    ...collectRevisionGovernanceGates({
      context: req.context,
      adapter,
      targetType: "saved-group",
      entity: savedGroup as unknown as Record<string, unknown>,
      revision,
    }),
    ...(await collectSavedGroupArchiveDependentsGate(
      req.context,
      savedGroup,
      desiredState,
    )),
  ];

  const { blocking, bypassed } = evaluatePublishGates(gates, {
    ignoreWarnings: req.context.ignoreWarnings,
    skipSchemaValidation: req.context.skipSchemaValidation,
    skipHooks: req.context.skipHooks,
    bypassApprovalPermission: adapter.canBypassApproval(
      req.context,
      savedGroup as Record<string, unknown>,
    ),
    restApiBypassesReviews: !!req.organization.settings?.restApiBypassesReviews,
    canForceMergeStaleBase: canBypass,
  });
  if (blocking.length) {
    throw new PublishBlockedError(blocking);
  }

  if (approvalRequired && revision.status !== "approved" && !canBypass) {
    throw new BadRequestError(
      `This revision requires approval before publishing (status: "${revision.status}"). ` +
        "Enable 'REST API always bypasses approval requirements' in organization settings, " +
        "or use a role/token that grants bypassApprovalChecks on this saved group's projects.",
    );
  }

  const isBypass = approvalRequired && revision.status !== "approved";

  // The live check above covers the source projects. If the revision moves the
  // group to different projects, also require update permission on the
  // destination (publish alone doesn't grant a cross-project move).
  const proposedProjects = (desiredState as { projects?: string[] }).projects;
  const movesProjects =
    proposedProjects !== undefined &&
    JSON.stringify([...proposedProjects].sort()) !==
      JSON.stringify([...(savedGroup.projects ?? [])].sort());
  if (
    movesProjects &&
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
    adapter.getUpdatableFields(),
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
  // live saved group must be rebased first. `ignoreWarnings` force-merges the
  // stale revision — but only for bypass-approval callers, and asking without
  // the permission fails loudly rather than silently re-blocking.
  if (req.organization.settings?.requireRebaseBeforePublish) {
    const forceMergeRequested = req.context.ignoreWarnings;
    const forceMerge = forceMergeRequested && canBypass;
    if (!forceMerge) {
      const diverged = isRevisionDiverged(
        adapter,
        revision.target.snapshot as Record<string, unknown>,
        savedGroup as unknown as Record<string, unknown>,
      );
      if (diverged && forceMergeRequested && !canBypass) {
        req.context.permissions.throwPermissionError();
      }
      if (diverged && !canBypass) {
        throw new ConflictError(
          "This revision was created against an older version of the saved group. " +
            'Rebase the revision first, or pass `"ignoreWarnings": true` to force-merge (requires the bypass-approval permission).',
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
      ...(bypassed.length ? { bypassedGates: bypassed } : {}),
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
    ...(bypassed.length ? { bypassedGates: bypassed } : {}),
  };
});
