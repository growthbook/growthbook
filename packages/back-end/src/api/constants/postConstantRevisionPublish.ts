import { isEqual } from "lodash";
import {
  checkMergeConflicts,
  normalizeProposedChanges,
} from "shared/enterprise";
import { postConstantRevisionPublishValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import {
  BadRequestError,
  ConflictError,
  MergeConflictError,
  NotFoundError,
} from "back-end/src/util/errors";
import { getAdapter } from "back-end/src/revisions";
import { buildMergeDesiredState } from "back-end/src/revisions/util";
import { dispatchConstantRevisionEvent } from "back-end/src/services/constantRevisionEvents";
import { loadRevisionByVersion } from "./validations";
import { toApiConstantRevision } from "./toApiConstantRevision";

export const postConstantRevisionPublish = createApiRequestHandler(
  postConstantRevisionPublishValidator,
)(async (req) => {
  const constant = await req.context.models.constants.getById(
    req.params.constantId,
  );
  if (!constant) {
    throw new NotFoundError("Could not find constant");
  }

  const revision = await loadRevisionByVersion(
    req.context,
    constant.id,
    req.params.version,
  );

  if (revision.status === "merged" || revision.status === "discarded") {
    throw new BadRequestError(
      `Cannot publish a revision with status "${revision.status}"`,
    );
  }

  const adapter = getAdapter("constant");

  // Re-check edit permission against the LIVE entity (a `project` move in the
  // proposed changes shouldn't be able to launder write access).
  if (!adapter.canUpdate(req.context, constant as Record<string, unknown>)) {
    req.context.permissions.throwPermissionError();
  }

  // Change-aware approval gate (the constant adapter reads target.snapshot).
  const approvalRequired = adapter.isApprovalRequiredForRevision
    ? adapter.isApprovalRequiredForRevision(req.context, revision)
    : adapter.isApprovalRequired(req.context);

  const canBypass =
    !!req.organization.settings?.restApiBypassesReviews ||
    adapter.canBypassApproval(req.context, constant as Record<string, unknown>);

  if (approvalRequired && revision.status !== "approved" && !canBypass) {
    throw new BadRequestError(
      `This revision requires approval before publishing (status: "${revision.status}"). ` +
        "Enable 'REST API always bypasses approval requirements' in organization settings, " +
        "or use a role/token that grants bypassApprovalChecks on this constant's project.",
    );
  }

  const isBypass = approvalRequired && revision.status !== "approved";

  // Layer proposed changes on top of LIVE (not the snapshot) so out-of-band
  // writes to fields the revision didn't touch are preserved.
  const desiredState = buildMergeDesiredState(
    constant as unknown as Record<string, unknown>,
    revision.target.snapshot as Record<string, unknown>,
    revision.target.proposedChanges,
    adapter.getUpdatableFields(),
  );

  // Pre-merge conflict guard — block landing on top of out-of-band edits to the
  // same field; caller must rebase first.
  const conflictResult = checkMergeConflicts(
    revision.target.snapshot as Record<string, unknown>,
    constant as unknown as Record<string, unknown>,
    normalizeProposedChanges(revision.target.proposedChanges),
  );
  if (!conflictResult.success) {
    throw new MergeConflictError(
      "Merge conflicts exist — rebase before publishing",
      conflictResult.conflicts,
    );
  }

  const updatableFields = adapter.getUpdatableFields();

  // Same-base governance: when the org enforces rebase-before-publish, a stale
  // revision must be rebased first. `mergeNow` only takes effect for bypass
  // callers; otherwise it's ignored.
  if (req.organization.settings?.requireRebaseBeforePublish) {
    const forceMerge = !!req.body.mergeNow && canBypass;
    if (!forceMerge) {
      const snapshot = revision.target.snapshot as Record<string, unknown>;
      const liveEntity = constant as unknown as Record<string, unknown>;
      const diverged = [...updatableFields].some(
        (key) => !isEqual(snapshot[key], liveEntity[key]),
      );
      if (diverged && !canBypass) {
        throw new ConflictError(
          "This revision was created against an older version of the constant. " +
            'Rebase the revision first. ("mergeNow": true bypasses this only with bypass-approval permission.)',
        );
      }
    }
  }

  const hasChanges = Object.keys(desiredState).some((key) => {
    if (!updatableFields.has(key)) return false;
    return !isEqual(
      desiredState[key],
      (constant as unknown as Record<string, unknown>)[key],
    );
  });

  // No diff vs live: a genuine no-op publish, or a recovery retry after a
  // partial failure (applyChanges landed, merge didn't). Either way, just merge
  // the revision so a stranded draft self-heals.
  if (!hasChanges) {
    const merged = await req.context.models.revisions.merge(
      revision.id,
      req.context.userId,
      { bypass: isBypass },
    );
    await dispatchConstantRevisionEvent(req.context, merged, {
      type: merged.revertedFrom ? "reverted" : "published",
    });
    return { revision: await toApiConstantRevision(merged, req.context) };
  }

  // Two-step merge — apply to the live entity, then mark the revision merged.
  await adapter.applyChanges(
    req.context,
    constant as unknown as Record<string, unknown>,
    desiredState,
    { isRevert: !!revision.revertedFrom },
  );

  const merged = await req.context.models.revisions.merge(
    revision.id,
    req.context.userId,
    { bypass: isBypass },
  );

  await dispatchConstantRevisionEvent(req.context, merged, {
    type: merged.revertedFrom ? "reverted" : "published",
  });

  return { revision: await toApiConstantRevision(merged, req.context) };
});
