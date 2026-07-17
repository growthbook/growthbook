import { isEqual } from "lodash";
import {
  checkMergeConflicts,
  normalizeProposedChanges,
} from "shared/enterprise";
import { postConfigRevisionPublishValidator } from "shared/validators";
import { SimpleSchema } from "shared/types/feature";
import { createApiRequestHandler } from "back-end/src/util/handler";
import {
  BadRequestError,
  ConflictError,
  MergeConflictError,
  NotFoundError,
} from "back-end/src/util/errors";
import { getAdapter } from "back-end/src/revisions";
import {
  assertPublishGates,
  PublishGate,
} from "back-end/src/revisions/publishGates";
import { canUseRestApiBypassSetting } from "back-end/src/api/features/reviewBypass";
import {
  buildMergeDesiredState,
  isRevisionDiverged,
} from "back-end/src/revisions/util";
import { assertConfigValueValidForPublish } from "back-end/src/services/configValidation";
import { assertConfigNotLocked } from "back-end/src/services/configLock";
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

  // Locked config: block before any merge is claimed. Unlock to publish.
  assertConfigNotLocked(config);

  const revision = await loadRevisionByVersion(
    req.context,
    config.id,
    req.params.version,
  );

  const adapter = getAdapter("config");

  // Re-check edit permission against the LIVE entity (a proposed `project` move
  // shouldn't launder write access) before leaking any revision state.
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
    canUseRestApiBypassSetting(req) ||
    adapter.canBypassApproval(req.context, config as Record<string, unknown>);

  // Layer proposed changes on LIVE (not the snapshot) so out-of-band writes to
  // untouched fields are preserved.
  const desiredState = buildMergeDesiredState(
    config as unknown as Record<string, unknown>,
    revision.target.snapshot as Record<string, unknown>,
    revision.target.proposedChanges,
    adapter.getUpdatableFields(),
  );

  // Aggregate every publish gate up front so a blocked publish returns ONE
  // structured 422 naming each gate and the body flag that clears it. The
  // approval, stale-base, and value-validation checks below stay in place as
  // the enforcement backstop; the adapter-collected guard gates are enforced
  // solely here.
  const gates: PublishGate[] = [];
  if (approvalRequired && revision.status !== "approved" && !canBypass) {
    gates.push({
      type: "approval-required",
      severity: "blocker",
      messages: [
        `Requires approval — submit the revision for review, or a caller with the bypassApprovalChecks permission can publish directly (status: "${revision.status}").`,
      ],
    });
  }
  if (
    req.organization.settings?.requireRebaseBeforePublish &&
    !canBypass &&
    isRevisionDiverged(
      adapter,
      revision.target.snapshot as Record<string, unknown>,
      config as unknown as Record<string, unknown>,
    )
  ) {
    gates.push({
      type: "stale-base",
      severity: "blocker",
      messages: [
        "This revision was created against an older version of the config. Rebase the revision first.",
      ],
      override: "ignoreWarnings",
      requiresPermission: "bypassApprovalChecks",
    });
  }
  gates.push(
    ...((await adapter.collectPublishGates?.(
      req.context,
      config as unknown as Record<string, unknown>,
      revision,
      desiredState,
    )) ?? []),
  );
  assertPublishGates(
    gates,
    {
      ignoreWarnings: req.context.ignoreWarnings,
      skipSchemaValidation: req.context.skipSchemaValidation,
    },
    (permission) =>
      permission === "bypassApprovalChecks" &&
      adapter.canBypassApproval(req.context, config as Record<string, unknown>),
  );

  if (approvalRequired && revision.status !== "approved" && !canBypass) {
    throw new BadRequestError(
      `This revision requires approval before publishing (status: "${revision.status}"). ` +
        "Enable 'REST API always bypasses approval requirements' in organization settings, " +
        "or use a role/token that grants bypassApprovalChecks on this config's project.",
    );
  }

  const isBypass = approvalRequired && revision.status !== "approved";

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
    adapter.getUpdatableFields(),
  );
  if (!conflictResult.success) {
    throw new MergeConflictError(
      "Merge conflicts exist — rebase before publishing",
      conflictResult.conflicts,
    );
  }

  const updatableFields = adapter.getUpdatableFields();

  // When the org enforces rebase-before-publish, a diverged revision must
  // rebase first. `ignoreWarnings` force-merges the stale draft — but only for
  // bypass-approval callers, and asking without the permission fails loudly
  // rather than silently re-blocking.
  if (req.organization.settings?.requireRebaseBeforePublish) {
    const forceMerge = req.context.ignoreWarnings && canBypass;
    if (!forceMerge) {
      const diverged = isRevisionDiverged(
        adapter,
        revision.target.snapshot as Record<string, unknown>,
        config as unknown as Record<string, unknown>,
      );
      if (diverged && req.context.ignoreWarnings && !canBypass) {
        req.context.permissions.throwPermissionError();
      }
      if (diverged && !canBypass) {
        throw new ConflictError(
          "This revision was created against an older version of the config. " +
            'Rebase the revision first, or pass `"ignoreWarnings": true` to force-merge (requires the bypass-approval permission).',
        );
      }
    }
  }

  const changedFields = Object.keys(desiredState).filter(
    (key) =>
      updatableFields.has(key) &&
      !isEqual(
        desiredState[key],
        (config as unknown as Record<string, unknown>)[key],
      ),
  );
  const hasChanges = changedFields.length > 0;

  // No diff vs live (no-op publish or recovery retry): replay the descendant
  // reconcile (idempotent; only acts on schema/parent/extends changes) so a
  // retry after a partially-applied publish still heals descendants, then merge.
  if (!hasChanges) {
    await adapter.beforeNoOpMerge?.(
      req.context,
      config as unknown as Record<string, unknown>,
      revision,
    );
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

  // Experiment/lock/schema-break guards were enforced above via the adapter's
  // collectPublishGates + assertPublishGates (the collector also records any
  // synchronous override in the logs), so no separate assert runs here.

  // Publish-time safety net: the post-publish value must still conform to its
  // effective schema (catches ancestor-schema changes and skip-flag stages).
  const postValue = (desiredState.value as string | undefined) ?? config.value;
  await assertConfigValueValidForPublish(
    req.context,
    {
      key: config.key,
      name: config.name,
      value: postValue,
      // Use desiredState.schema directly (a full post-merge snapshot, so it's
      // authoritative): `?? config.schema` would resurrect the live schema on
      // a `null` clear (revert to a schema-less revision).
      schema: desiredState.schema as SimpleSchema | null | undefined,
      parent: (desiredState.parent as string | undefined) ?? config.parent,
      extends: (desiredState.extends as string[] | undefined) ?? config.extends,
      extensible:
        (desiredState.extensible as boolean | undefined) ?? config.extensible,
    },
    { value: postValue },
    revision,
  );

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
    // Couldn't apply after claiming the merge — roll back to the pre-merge state
    // so the revision isn't stranded "merged" with the live config unchanged.
    // Use reopenAfterFailedApply (not a plain reopen) to restore the status,
    // schedule, and experiment-guard acknowledgment that `merge` scrubbed — so a
    // retry doesn't lose a pending schedule or re-prompt an already-acknowledged
    // guard. Mirrors the deferred publish path; falls back to a plain reopen.
    try {
      const restored =
        await req.context.models.revisions.reopenAfterFailedApply(
          merged.id,
          req.context.userId,
          revision,
        );
      if (!restored) {
        await req.context.models.revisions.reopen(
          merged.id,
          req.context.userId,
        );
      }
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
