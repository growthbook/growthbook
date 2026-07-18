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
import {
  evaluatePublishGates,
  PublishBlockedError,
  PublishGate,
} from "back-end/src/revisions/publishGates";
import { canUseRestApiBypassSetting } from "back-end/src/api/features/reviewBypass";
import {
  buildMergeDesiredState,
  isRevisionDiverged,
} from "back-end/src/revisions/util";
import { dispatchConstantRevisionEvent } from "back-end/src/services/constantRevisionEvents";
import { loadRevisionByVersion } from "./validations";
import { toApiConstantRevision } from "./toApiConstantRevision";

export const postConstantRevisionPublish = createApiRequestHandler(
  postConstantRevisionPublishValidator,
)(async (req) => {
  const constant = await req.context.models.constants.getByKey(req.params.key);
  if (!constant) {
    throw new NotFoundError("Could not find constant");
  }

  const revision = await loadRevisionByVersion(
    req.context,
    constant.id,
    req.params.version,
  );

  const adapter = getAdapter("constant");

  // Re-check edit permission against the LIVE entity (a `project` move in the
  // proposed changes shouldn't be able to launder write access) before leaking
  // any revision state.
  if (!adapter.canUpdate(req.context, constant as Record<string, unknown>)) {
    req.context.permissions.throwPermissionError();
  }

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
  const version = req.params.version;
  const gates: PublishGate[] = [];
  if (approvalRequired && revision.status !== "approved") {
    gates.push({
      type: "approval-required",
      severity: "blocker",
      messages: [
        `Requires approval before publishing (status: "${revision.status}").`,
      ],
      override: null,
      requiresPermission: "bypassApprovalChecks",
      resolution: {
        action: "request-review",
        method: "POST",
        path: `/constants-revisions/${constant.key}/${version}/request-review`,
      },
    });
  }
  if (
    req.organization.settings?.requireRebaseBeforePublish &&
    isRevisionDiverged(
      adapter,
      revision.target.snapshot as Record<string, unknown>,
      constant as unknown as Record<string, unknown>,
    )
  ) {
    gates.push({
      type: "stale-base",
      severity: "blocker",
      messages: ["This revision was created against an older version."],
      override: "ignoreWarnings",
      requiresPermission: "bypassApprovalChecks",
      resolution: {
        action: "rebase",
        method: "POST",
        path: `/constants-revisions/${constant.key}/${version}/rebase`,
      },
    });
  }
  gates.push(
    ...((await adapter.collectPublishGates?.(
      req.context,
      constant as unknown as Record<string, unknown>,
      revision,
      desiredState,
    )) ?? []),
  );
  const { blocking, bypassed } = evaluatePublishGates(gates, {
    ignoreWarnings: req.context.ignoreWarnings,
    skipSchemaValidation: req.context.skipSchemaValidation,
    bypassApprovalPermission: adapter.canBypassApproval(
      req.context,
      constant as Record<string, unknown>,
    ),
    restApiBypassesReviews: canUseRestApiBypassSetting(req),
    canForceMergeStaleBase: canBypass,
  });
  if (blocking.length) {
    throw new PublishBlockedError(blocking);
  }

  if (approvalRequired && revision.status !== "approved" && !canBypass) {
    throw new BadRequestError(
      `This revision requires approval before publishing (status: "${revision.status}"). ` +
        "Enable 'REST API always bypasses approval requirements' in organization settings, " +
        "or use a role/token that grants bypassApprovalChecks on this constant's project.",
    );
  }

  const isBypass = approvalRequired && revision.status !== "approved";

  // The live check above covers the source project. If the revision moves the
  // constant to a different project, also require update permission on the
  // destination.
  if (
    !adapter.canUpdate(req.context, {
      ...(constant as unknown as Record<string, unknown>),
      ...desiredState,
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

  const updatableFields = adapter.getUpdatableFields();

  // Same-base governance: when the org enforces rebase-before-publish, a stale
  // revision must be rebased first. `ignoreWarnings` force-merges the stale
  // draft — but only for bypass-approval callers, and asking without the
  // permission fails loudly rather than silently re-blocking.
  if (req.organization.settings?.requireRebaseBeforePublish) {
    const forceMerge = req.context.ignoreWarnings && canBypass;
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
          "This revision was created against an older version of the constant. " +
            'Rebase the revision first, or pass `"ignoreWarnings": true` to force-merge (requires the bypass-approval permission).',
        );
      }
    }
  }

  // Experiment/lock/schema-break guards were enforced above via the adapter's
  // collectPublishGates + evaluatePublishGates (the collector also records any
  // synchronous override in the logs), so no separate assert runs here.

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
    return {
      revision: await toApiConstantRevision(merged, req.context),
      ...(bypassed.length ? { bypassedGates: bypassed } : {}),
    };
  }

  // Claim the merge BEFORE applying to the live entity. `merge` is CAS-guarded,
  // so a concurrent discard either already lost (merge throws, nothing applied)
  // or will lose (its `close` CAS-fails). This closes the window where a discard
  // landing between applyChanges and merge would orphan a half-applied change.
  const merged = await req.context.models.revisions.merge(
    revision.id,
    req.context.userId,
    { bypass: isBypass },
  );

  try {
    await adapter.applyChanges(
      req.context,
      constant as unknown as Record<string, unknown>,
      desiredState,
      { isRevert: !!revision.revertedFrom },
    );
  } catch (e) {
    // Couldn't apply after claiming the merge — reopen so the revision isn't
    // stranded "merged" with the live constant unchanged; a retry re-runs the
    // publish (and the no-op self-heal path above if it was partially applied).
    try {
      await req.context.models.revisions.reopen(merged.id, req.context.userId);
    } catch {
      // ignore — surface the original applyChanges error
    }
    throw e;
  }

  await dispatchConstantRevisionEvent(req.context, merged, {
    type: merged.revertedFrom ? "reverted" : "published",
  });

  return {
    revision: await toApiConstantRevision(merged, req.context),
    ...(bypassed.length ? { bypassedGates: bypassed } : {}),
  };
});
