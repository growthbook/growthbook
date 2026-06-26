import { isEqual } from "lodash";
import {
  checkMergeConflicts,
  normalizeProposedChanges,
} from "shared/enterprise";
import { postConfigRevisionPublishValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import {
  BadRequestError,
  ConflictError,
  MergeConflictError,
  NotFoundError,
} from "back-end/src/util/errors";
import { getAdapter } from "back-end/src/revisions";
import { buildMergeDesiredState } from "back-end/src/revisions/util";
import { dispatchConfigRevisionEvent } from "back-end/src/services/configRevisionEvents";
import { loadRevisionByVersion } from "./validations";
import { toApiConfigRevision } from "./toApiConfigRevision";

export const postConfigRevisionPublish = createApiRequestHandler(
  postConfigRevisionPublishValidator,
)(async (req) => {
  const config = await req.context.models.configs.getByKey(req.params.key);
  if (!config) {
    throw new NotFoundError("Could not find config");
  }

  const revision = await loadRevisionByVersion(
    req.context,
    config.id,
    req.params.version,
  );

  const adapter = getAdapter("config");

  // Re-check edit permission against the LIVE entity (a `project` move in the
  // proposed changes shouldn't launder write access) before leaking any
  // revision state.
  if (!adapter.canUpdate(req.context, config as Record<string, unknown>)) {
    req.context.permissions.throwPermissionError();
  }

  if (revision.status === "merged" || revision.status === "discarded") {
    throw new BadRequestError(
      `Cannot publish a revision with status "${revision.status}"`,
    );
  }

  // Change-aware approval gate (the config adapter reads target.snapshot).
  const approvalRequired = adapter.isApprovalRequiredForRevision
    ? adapter.isApprovalRequiredForRevision(req.context, revision)
    : adapter.isApprovalRequired(req.context);

  const canBypass =
    !!req.organization.settings?.restApiBypassesReviews ||
    adapter.canBypassApproval(req.context, config as Record<string, unknown>);

  if (approvalRequired && revision.status !== "approved" && !canBypass) {
    throw new BadRequestError(
      `This revision requires approval before publishing (status: "${revision.status}"). ` +
        "Enable 'REST API always bypasses approval requirements' in organization settings, " +
        "or use a role/token that grants bypassApprovalChecks on this config's project.",
    );
  }

  const isBypass = approvalRequired && revision.status !== "approved";

  // Layer proposed changes on top of LIVE (not the snapshot) so out-of-band
  // writes to fields the revision didn't touch are preserved.
  const desiredState = buildMergeDesiredState(
    config as unknown as Record<string, unknown>,
    revision.target.snapshot as Record<string, unknown>,
    revision.target.proposedChanges,
    adapter.getUpdatableFields(),
  );

  // If the revision moves the config to a different project, also require update
  // permission on the destination.
  if (
    !adapter.canUpdate(req.context, {
      ...(config as unknown as Record<string, unknown>),
      ...desiredState,
    })
  ) {
    req.context.permissions.throwPermissionError();
  }

  // Pre-merge conflict guard — block landing on top of out-of-band edits to the
  // same field; caller must rebase first.
  const conflictResult = checkMergeConflicts(
    revision.target.snapshot as Record<string, unknown>,
    config as unknown as Record<string, unknown>,
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
      const liveEntity = config as unknown as Record<string, unknown>;
      const diverged = [...updatableFields].some(
        (key) => !isEqual(snapshot[key], liveEntity[key]),
      );
      if (diverged && !canBypass) {
        throw new ConflictError(
          "This revision was created against an older version of the config. " +
            'Rebase the revision first. ("mergeNow": true bypasses this only with bypass-approval permission.)',
        );
      }
    }
  }

  const hasChanges = Object.keys(desiredState).some((key) => {
    if (!updatableFields.has(key)) return false;
    return !isEqual(
      desiredState[key],
      (config as unknown as Record<string, unknown>)[key],
    );
  });

  // No diff vs live: a genuine no-op publish, or a recovery retry after a
  // partial failure. Either way, just merge the revision so a stranded draft
  // self-heals.
  if (!hasChanges) {
    const merged = await req.context.models.revisions.merge(
      revision.id,
      req.context.userId,
      { bypass: isBypass },
    );
    await dispatchConfigRevisionEvent(req.context, merged, {
      type: merged.revertedFrom ? "reverted" : "published",
    });
    return { revision: await toApiConfigRevision(merged, req.context) };
  }

  // Claim the merge BEFORE applying to the live entity. `merge` is CAS-guarded,
  // so a concurrent discard either already lost or will lose its `close` CAS.
  const merged = await req.context.models.revisions.merge(
    revision.id,
    req.context.userId,
    { bypass: isBypass },
  );

  try {
    // The config adapter's applyChanges re-runs "base wins" schema
    // normalization and cascades the reconcile to descendants.
    await adapter.applyChanges(
      req.context,
      config as unknown as Record<string, unknown>,
      desiredState,
      { isRevert: !!revision.revertedFrom },
    );
  } catch (e) {
    // Couldn't apply after claiming the merge — reopen so the revision isn't
    // stranded "merged" with the live config unchanged.
    try {
      await req.context.models.revisions.reopen(merged.id, req.context.userId);
    } catch {
      // ignore — surface the original applyChanges error
    }
    throw e;
  }

  await dispatchConfigRevisionEvent(req.context, merged, {
    type: merged.revertedFrom ? "reverted" : "published",
  });

  return { revision: await toApiConfigRevision(merged, req.context) };
});
