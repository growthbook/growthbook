import {
  holdsMoveDestination,
  projectScopeChanged,
  type ProjectScoped,
} from "shared/permissions";
import {
  checkMergeConflicts,
  normalizeProposedChanges,
} from "shared/enterprise";
import { postConstantRevisionPublishValidator } from "shared/validators";
import {
  publishRevision,
  assertCanPublishRevision,
} from "back-end/src/revisions/revisionActions";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { resolvePublishFootprint } from "back-end/src/revisions/revisionPublishEnvironments";
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
import { canUseRestApiBypassSetting } from "back-end/src/api/features/reviewBypass";
import {
  buildMergeDesiredState,
  isRevisionDiverged,
} from "back-end/src/revisions/util";
import { collectRevisionGovernanceGates } from "back-end/src/revisions/governanceGates";
import { loadRevisionByVersion } from "./validations";
import { toApiConstantRevision } from "./toApiConstantRevision";

export const postConstantRevisionPublish = createApiRequestHandler(
  postConstantRevisionPublishValidator,
)(async (req) => {
  const constant = await req.context.models.constants.getByKey(req.params.key);
  if (!constant) {
    throw new NotFoundError("Could not find Constant");
  }

  const revision = await loadRevisionByVersion(
    req.context,
    constant.id,
    req.params.version,
  );

  const adapter = getAdapter("constant");

  // Publish authority on the live entity, or revert authority for a pure revert
  // (project-move manage checked below).
  await assertCanPublishRevision(req.context, revision, constant);

  if (revision.status === "merged" || revision.status === "discarded") {
    throw new BadRequestError(
      `Cannot publish a revision with status "${revision.status}"`,
    );
  }

  // Change-aware approval gate (the constant adapter reads target.snapshot).
  const approvalRequired = adapter.isApprovalRequiredForRevision
    ? adapter.isApprovalRequiredForRevision(req.context, revision)
    : adapter.isApprovalRequired(req.context);

  const canBypass =
    canUseRestApiBypassSetting(req) ||
    adapter.canBypassApproval(req.context, constant as Record<string, unknown>);

  // Approval bypass does not permit merging a stale base.
  const canForceMerge = adapter.canBypassApproval(
    req.context,
    constant as Record<string, unknown>,
  );

  // Layer proposed changes on top of LIVE (not the snapshot) so out-of-band
  // writes to fields the revision didn't touch are preserved.
  const desiredState = buildMergeDesiredState(
    constant as unknown as Record<string, unknown>,
    revision.target.snapshot as Record<string, unknown>,
    revision.target.proposedChanges,
    adapter.getUpdatableFields(),
  );

  // Aggregate every publish gate up front so a blocked publish returns ONE
  // structured 422 naming each gate, the flag that clears it, and a callable
  // resolution route. Gates are assembled for every ACTIVE condition (whether
  // or not the caller can bypass it) so a successful publish can report the ones
  // that were bypassed. The approval and stale-base checks below stay in place
  // as the enforcement backstop; the adapter-collected guard gates are enforced
  // solely here.
  const gates: PublishGate[] = collectRevisionGovernanceGates({
    context: req.context,
    adapter,
    targetType: "constant",
    entity: constant as unknown as Record<string, unknown>,
    revision,
  });
  gates.push(
    ...((await adapter.collectPublishGates?.(
      req.context,
      constant as unknown as Record<string, unknown>,
      revision,
      desiredState,
    )) ?? []),
  );
  const { bypassed } = resolveEntityPublishGates({
    entityType: "constant",
    req,
    gates,
    bypassApprovalPermission: adapter.canBypassApproval(
      req.context,
      constant as unknown as Record<string, unknown>,
    ),
    canForceMergeStaleBase: canForceMerge,
  });

  if (approvalRequired && revision.status !== "approved" && !canBypass) {
    throw new BadRequestError(
      `This revision requires approval before publishing (status: "${revision.status}"). ` +
        "Enable 'REST API always bypasses approval requirements' in organization settings, " +
        "or use a role/token that grants FlagsBypassApprovals on this Constant's project.",
    );
  }

  const isBypass = approvalRequired && revision.status !== "approved";

  // The state this publish would land, used below to authorize a relocation
  // into the destination project.
  const destination = {
    ...(constant as unknown as Record<string, unknown>),
    ...desiredState,
  };
  if (
    // In-place publishes are already authorized above (narrow revert/archive
    // atoms included); only a relocation needs the destination publish check.
    (projectScopeChanged(
      constant as ProjectScoped,
      destination as ProjectScoped,
    ) &&
      !adapter.canUpdate(req.context, destination)) ||
    !holdsMoveDestination({
      permissions: req.context.permissions,
      model: "constant",
      action: "publish",
      existing: constant as ProjectScoped,
      proposed: destination as ProjectScoped,
      environments: resolvePublishFootprint(
        req.context,
        adapter.publishFootprint?.(
          req.context,
          constant as unknown as Record<string, unknown>,
          revision.target.proposedChanges,
        ),
        constant as ProjectScoped,
      ),
    })
  ) {
    req.context.permissions.throwPermissionError();
  }

  // Pre-merge conflict guard — block landing on top of out-of-band edits to the
  // same field; caller must rebase first.
  const conflictResult = checkMergeConflicts(
    revision.target.snapshot as Record<string, unknown>,
    constant as unknown as Record<string, unknown>,
    normalizeProposedChanges(revision.target.proposedChanges),
    adapter.getUpdatableFields(),
  );
  if (!conflictResult.success) {
    throw new MergeConflictError(
      "Merge conflicts exist — rebase before publishing",
      conflictResult.conflicts,
    );
  }

  // Same-base governance: when the org enforces rebase-before-publish, a stale
  // revision must be rebased first. `ignoreWarnings` force-merges the stale
  // draft — but only for bypass-approval callers, and asking without the
  // permission fails loudly rather than silently re-blocking.
  if (req.organization.settings?.requireRebaseBeforePublish) {
    const forceMerge = req.context.ignoreWarnings && canForceMerge;
    if (!forceMerge) {
      const diverged = isRevisionDiverged(
        adapter,
        revision.target.snapshot as Record<string, unknown>,
        constant as unknown as Record<string, unknown>,
      );
      if (diverged && req.context.ignoreWarnings && !canBypass) {
        req.context.permissions.throwPermissionError();
      }
      if (diverged && !canBypass) {
        throw new ConflictError(
          "This revision was created against an older version of the Constant. " +
            'Rebase the revision first, or pass `"ignoreWarnings": true` to force-merge (requires the bypass-approval permission).',
        );
      }
    }
  }

  // Experiment/lock/schema-break guards were enforced above via the adapter's
  // collectPublishGates + evaluatePublishGates (the collector also records any
  // synchronous override in the logs), so no separate assert runs here.

  // Keep no-op publishes on the shared gated path.
  const merged = await publishRevision(
    req.context,
    revision,
    constant as unknown as Record<string, unknown>,
    { bypass: isBypass, skipHooks: true },
  );

  return {
    revision: await toApiConstantRevision(merged, req.context),
    ...(bypassed.length ? { bypassedGates: bypassed } : {}),
  };
});
