import { holdsMoveDestination, type ProjectScoped } from "shared/permissions";
import {
  checkMergeConflicts,
  normalizeProposedChanges,
} from "shared/enterprise";
import { postSavedGroupRevisionPublishValidator } from "shared/validators";
import { canUseRestApiBypassSetting } from "back-end/src/api/features/reviewBypass";
import {
  publishRevision,
  assertCanPublishRevision,
} from "back-end/src/revisions/revisionActions";
import { createApiRequestHandler } from "back-end/src/util/handler";
import {
  BadRequestError,
  ConflictError,
  MergeConflictError,
  NotFoundError,
} from "back-end/src/util/errors";
import { getAdapter } from "back-end/src/revisions";
import {
  resolveEntityPublishGates,
  PublishGate,
} from "back-end/src/revisions/publishGates";
import {
  buildMergeDesiredState,
  isRevisionDiverged,
} from "back-end/src/revisions/util";
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

  // Publish authority on the LIVE entity (not just the snapshot), or revert
  // authority for a pure revert (project-move manage checked below).
  await assertCanPublishRevision(req.context, revision, savedGroup);

  // Per-revision approval gate: saved-group adapter has a metadata-only
  // shortcut, so honour `isApprovalRequiredForRevision` when available.
  const approvalRequired = adapter.isApprovalRequiredForRevision
    ? adapter.isApprovalRequiredForRevision(req.context, revision)
    : adapter.isApprovalRequired(req.context);

  // The org-wide REST bypass or per-user bypass permission. Via
  // canUseRestApiBypassSetting, which also requires a non-JWT caller.
  const canBypass =
    canUseRestApiBypassSetting(req) ||
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

  const { bypassed } = resolveEntityPublishGates({
    entityType: "saved-group",
    req,
    gates,
    bypassApprovalPermission: adapter.canBypassApproval(
      req.context,
      savedGroup as unknown as Record<string, unknown>,
    ),
    canForceMergeStaleBase: canBypass,
  });

  if (approvalRequired && revision.status !== "approved" && !canBypass) {
    throw new BadRequestError(
      `This revision requires approval before publishing (status: "${revision.status}"). ` +
        "Enable 'REST API always bypasses approval requirements' in organization settings, " +
        "or use a role/token that grants bypassApprovalSavedGroups on this Saved Group's projects.",
    );
  }

  const isBypass = approvalRequired && revision.status !== "approved";

  // A projects move (including a clear to global) lands content in the
  // destination, so it takes edit rights on the resulting doc AND publish
  // authority there. Saved Groups carry no environment footprint, so the
  // destination check is project-scoped.
  const destination = {
    ...(savedGroup as unknown as Record<string, unknown>),
    ...desiredState,
  };
  if (
    !adapter.canUpdate(req.context, destination) ||
    !holdsMoveDestination({
      permissions: req.context.permissions,
      model: "saved-group",
      action: "publish",
      existing: savedGroup as ProjectScoped,
      proposed: destination as ProjectScoped,
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

  // No diff between the revision's desired state and the live entity. This is
  // No-op publishes are NOT short-circuited here. The engine has its own no-op
  // branch — same beforeNoOpMerge, merge and dispatch — and reaching it means a
  // no-op still passes assertPublishable, which is the point: publishing is the
  // gated action even when nothing changes, so a locked Config cannot have its
  // latest-merged pointer advanced past the pin by publishing an empty diff.

  // Delegates claim → apply → compensate → dispatch to the shared engine rather
  // than repeating it. This handler's job is the gate layer above; the engine
  // owns the write sequence, its CAS claim, the guarded compensation, and
  // stranded-merge recovery.
  const merged = await publishRevision(
    req.context,
    revision,
    savedGroup as unknown as Record<string, unknown>,
    { bypass: isBypass, skipHooks: true },
  );

  return {
    revision: await toApiSavedGroupRevision(merged, req.context),
    ...(bypassed.length ? { bypassedGates: bypassed } : {}),
  };
});
