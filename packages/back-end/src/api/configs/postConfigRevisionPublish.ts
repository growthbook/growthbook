import {
  holdsMoveDestination,
  projectScopeChanged,
  type ProjectScoped,
} from "shared/permissions";
import {
  checkMergeConflicts,
  normalizeProposedChanges,
} from "shared/enterprise";
import { postConfigRevisionPublishValidator } from "shared/validators";
import { SimpleSchema } from "shared/types/feature";
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
import {
  assertConfigValueValidForPublish,
  collectConfigPublishHookGates,
} from "back-end/src/services/configValidation";
import {
  assertConfigNotLocked,
  collectConfigLockGate,
} from "back-end/src/services/configLock";
import { collectRevisionGovernanceGates } from "back-end/src/revisions/governanceGates";
import { loadRevisionByVersion } from "./validations";
import { toApiConfigRevision } from "./toApiConfigRevision";

export const postConfigRevisionPublish = createApiRequestHandler(
  postConfigRevisionPublishValidator,
)(async (req) => {
  const config = await req.context.models.configs.getByKey(req.params.key);
  if (!config) {
    throw new NotFoundError("Could not find Config");
  }

  const revision = await loadRevisionByVersion(
    req.context,
    config.id,
    req.params.version,
  );

  const adapter = getAdapter("config");

  // Publish authority on the live entity, or revert authority for a pure revert
  // (project-move manage checked below).
  await assertCanPublishRevision(req.context, revision, config);

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

  // Approval bypass does not permit merging a stale base.
  const canForceMerge = adapter.canBypassApproval(
    req.context,
    config as Record<string, unknown>,
  );

  // Layer proposed changes on LIVE (not the snapshot) so out-of-band writes to
  // untouched fields are preserved.
  const desiredState = buildMergeDesiredState(
    config as unknown as Record<string, unknown>,
    revision.target.snapshot as Record<string, unknown>,
    revision.target.proposedChanges,
    adapter.getUpdatableFields(),
  );

  // Aggregate every publish gate up front so a blocked publish returns ONE
  // structured 422 naming each gate, the flag that clears it, and a callable
  // resolution route. Gates are assembled for every ACTIVE condition (whether
  // or not the caller can bypass it) so a successful publish can report the ones
  // that were bypassed. The lock, approval, stale-base, and value-validation
  // checks below stay in place as the enforcement backstop; the adapter-
  // collected guard gates are enforced solely here.
  const gates: PublishGate[] = [
    // Hard lock: no inline bypass on the publish path — only the unlock
    // route. assertConfigNotLocked below is the backstop.
    ...collectConfigLockGate(config),
    ...collectRevisionGovernanceGates({
      context: req.context,
      adapter,
      targetType: "config",
      entity: config as unknown as Record<string, unknown>,
      revision,
    }),
  ];
  gates.push(
    ...((await adapter.collectPublishGates?.(
      req.context,
      config as unknown as Record<string, unknown>,
      revision,
      desiredState,
    )) ?? []),
  );

  // Custom validation hooks, surfaced as gates (run here so the assert below
  // doesn't re-execute them).
  gates.push(
    ...(await collectConfigPublishHookGates({
      context: req.context,
      config,
      desiredState,
      revision,
    })),
  );

  const { bypassed } = resolveEntityPublishGates({
    entityType: "config",
    req,
    gates,
    bypassApprovalPermission: adapter.canBypassApproval(
      req.context,
      config as unknown as Record<string, unknown>,
    ),
    canForceMergeStaleBase: canForceMerge,
  });

  // Locked-config backstop behind the config-locked gate above — still well
  // before the merge is claimed, so a blocked publish leaves the draft open.
  assertConfigNotLocked(config);

  if (approvalRequired && revision.status !== "approved" && !canBypass) {
    throw new BadRequestError(
      `This revision requires approval before publishing (status: "${revision.status}"). ` +
        "Enable 'REST API always bypasses approval requirements' in organization settings, " +
        "or use a role/token that grants FlagsBypassApprovals on this Config's project.",
    );
  }

  const isBypass = approvalRequired && revision.status !== "approved";

  // The state this publish would land, used below to authorize a relocation
  // into the destination project.
  const destination = {
    ...(config as unknown as Record<string, unknown>),
    ...desiredState,
  };
  if (
    // In-place publishes are already authorized above (narrow revert/archive
    // atoms included); only a relocation needs the destination publish check.
    (projectScopeChanged(
      config as ProjectScoped,
      destination as ProjectScoped,
    ) &&
      !adapter.canUpdate(req.context, destination)) ||
    !holdsMoveDestination({
      permissions: req.context.permissions,
      model: "config",
      action: "publish",
      existing: config as ProjectScoped,
      proposed: destination as ProjectScoped,
      environments: resolvePublishFootprint(
        req.context,
        adapter.publishFootprint?.(
          req.context,
          config as unknown as Record<string, unknown>,
          revision.target.proposedChanges,
        ),
        config as ProjectScoped,
      ),
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

  // When the org enforces rebase-before-publish, a diverged revision must
  // rebase first. `ignoreWarnings` force-merges the stale draft — but only for
  // bypass-approval callers, and asking without the permission fails loudly
  // rather than silently re-blocking.
  if (req.organization.settings?.requireRebaseBeforePublish) {
    const forceMerge = req.context.ignoreWarnings && canForceMerge;
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
          "This revision was created against an older version of the Config. " +
            'Rebase the revision first, or pass `"ignoreWarnings": true` to force-merge (requires the bypass-approval permission).',
        );
      }
    }
  }

  // No-op publishes are NOT short-circuited here. The engine has its own no-op
  // branch — same beforeNoOpMerge, merge and dispatch — and reaching it means a
  // no-op still passes assertPublishable, which is the point: publishing is the
  // gated action even when nothing changes, so a locked Config cannot have its
  // latest-merged pointer advanced past the pin by publishing an empty diff.

  // Experiment/lock/schema-break guards were enforced above via the adapter's
  // collectPublishGates + evaluatePublishGates (the collector also records any
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
    // Hooks already ran above as gates — don't re-execute the sandboxed hook.
    { skipHooks: true },
  );

  const merged = await publishRevision(
    req.context,
    revision,
    config as unknown as Record<string, unknown>,
    { bypass: isBypass, skipHooks: true },
  );

  return {
    revision: await toApiConfigRevision(merged, req.context),
    ...(bypassed.length ? { bypassedGates: bypassed } : {}),
  };
});
