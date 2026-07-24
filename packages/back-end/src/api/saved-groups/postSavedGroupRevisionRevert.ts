import { isEqual } from "lodash";
import { JsonPatchOperation, Revision } from "shared/enterprise";
import { SavedGroupInterface } from "shared/types/saved-group";
import {
  postSavedGroupRevisionRevertValidator,
  savedGroupUpdatableFieldsSchema,
} from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import { getAdapter } from "back-end/src/revisions";
import {
  applyPatchToSnapshot,
  createOrUpdateRevision,
  ensureLiveRevisionExists,
} from "back-end/src/revisions/util";
import { dispatchSavedGroupRevisionEvent } from "back-end/src/services/savedGroupRevisionEvents";
import { assertSavedGroupArchiveDependentsGuard } from "back-end/src/services/archiveDependentsGuard";
import { loadRevisionByVersion } from "./validations";
import { toApiSavedGroupRevision } from "./toApiSavedGroupRevision";

export const postSavedGroupRevisionRevert = createApiRequestHandler(
  postSavedGroupRevisionRevertValidator,
)(async (req) => {
  const savedGroup = await req.context.models.savedGroups.getById(
    req.params.savedGroupId,
  );
  if (!savedGroup) {
    throw new NotFoundError("Could not find saved group");
  }

  const adapter = getAdapter("saved-group");
  if (!adapter.canUpdate(req.context, savedGroup as Record<string, unknown>)) {
    req.context.permissions.throwPermissionError();
  }

  const targetRevision = await loadRevisionByVersion(
    req.context,
    savedGroup.id,
    req.params.version,
  );

  // Cross-entity safety: `loadRevisionByVersion` already restricts by
  // (target.type, target.id). Re-checking here is a belt-and-braces guard
  // against future model-layer changes leaking across entity boundaries.
  if (
    targetRevision.target.type !== "saved-group" ||
    targetRevision.target.id !== savedGroup.id
  ) {
    throw new NotFoundError("Could not find saved group revision");
  }

  if (targetRevision.status !== "merged") {
    throw new BadRequestError(
      "Can only revert to a published (merged) revision. " +
        `Revision #${req.params.version} has status "${targetRevision.status}".`,
    );
  }

  // Reconstruct the saved-group state at the time of the historical revision.
  // `target.snapshot` is the base state captured when the revision was created
  // (before its changes were applied), so applying its proposedChanges yields
  // the post-merge state.
  const targetState = applyPatchToSnapshot(
    targetRevision.target.snapshot as SavedGroupInterface,
    targetRevision.target.proposedChanges,
  ) as SavedGroupInterface;

  // Build the revert change set as the diff between the historical state and
  // the current live entity. Fields equal to live are omitted so we don't
  // create no-op activity-log churn.
  const fieldsToUpdate: Record<string, unknown> = {};
  for (const field of Object.keys(savedGroupUpdatableFieldsSchema.shape)) {
    const targetValue = (targetState as Record<string, unknown>)[field];
    const liveValue = (savedGroup as unknown as Record<string, unknown>)[field];
    if (targetValue !== undefined && !isEqual(targetValue, liveValue)) {
      fieldsToUpdate[field] = targetValue;
    }
  }

  if (Object.keys(fieldsToUpdate).length === 0) {
    throw new BadRequestError(
      `Revision #${req.params.version} matches the current saved group — nothing to revert.`,
    );
  }

  // When the org enables "reverts bypass approval", reverts don't require
  // approval, so they publish by default (callers can still pass "draft").
  const revertsBypassApproval =
    !!req.organization.settings?.revertsBypassApproval;
  const strategy =
    req.body.strategy ?? (revertsBypassApproval ? "publish" : "draft");
  const isPublish = strategy === "publish";

  const patchOps: JsonPatchOperation[] = Object.entries(fieldsToUpdate).map(
    ([key, value]) => ({
      op: "replace" as const,
      path: `/${key}`,
      value,
    }),
  );

  // For `strategy: "publish"` the revert produces real content changes, so the
  // permission model mirrors postSavedGroupRevisionPublish — including its
  // per-revision gate, so a metadata-only revert isn't blocked when the org has
  // `requireMetadataReview` disabled. Hoisted so the merge call can record the
  // accurate bypass flag.
  let approvalRequired = false;
  let canBypass = false;
  if (isPublish) {
    // With "reverts bypass approval" enabled, a revert restores an
    // already-reviewed state and doesn't require approval at all, so it's a
    // normal merge rather than a recorded bypass.
    approvalRequired = revertsBypassApproval
      ? false
      : adapter.isApprovalRequiredForRevision
        ? adapter.isApprovalRequiredForRevision(req.context, {
            target: { proposedChanges: patchOps },
          } as unknown as Revision)
        : adapter.isApprovalRequired(req.context);
    canBypass =
      !!req.organization.settings?.restApiBypassesReviews ||
      adapter.canBypassApproval(
        req.context,
        savedGroup as Record<string, unknown>,
      );
    if (approvalRequired && !canBypass) {
      throw new BadRequestError(
        "This revert requires approval before changes can be published. " +
          'Use `strategy: "draft"` to create a draft for review, ' +
          "or use a role/token that grants bypassApprovalChecks.",
      );
    }
    // Reverting to a historically-archived state re-archives the group; soft-warn
    // (bypassably) if it still has live dependents. Only the archive transition.
    if (fieldsToUpdate.archived === true && !savedGroup.archived) {
      await assertSavedGroupArchiveDependentsGuard(
        req.context,
        { id: savedGroup.id },
        { armed: false },
      );
    }
  }

  await ensureLiveRevisionExists(
    req.context,
    "saved-group",
    savedGroup as unknown as Record<string, unknown> & {
      id: string;
      owner?: string;
      dateCreated?: Date;
    },
  );

  const defaultTitle = `Revert to v${req.params.version}`;
  const title = req.body.title ?? defaultTitle;

  if (!isPublish) {
    // Create a fresh draft for review — distinct from any other pending draft
    // from the same author so the revert has a clear audit-log entry.
    const draft = await createOrUpdateRevision(
      req.context,
      "saved-group",
      savedGroup as unknown as Record<string, unknown> & { id: string },
      patchOps,
      {
        forceCreate: true,
        title,
        revertedFrom: targetRevision.id,
      },
    );
    await dispatchSavedGroupRevisionEvent(req.context, draft, {
      type: "created",
    });

    return {
      revision: await toApiSavedGroupRevision(draft, req.context),
    };
  }

  // Record the already-merged revert revision FIRST, then apply it to the live
  // entity. If the apply fails, delete the just-created revision so we never
  // leave a "reverted" record with no corresponding live change. (The revision
  // is created in its terminal `merged` state, so there's no concurrent-discard
  // vector — this is a clean abort rather than a claim-then-CAS.)
  const merged = await req.context.models.revisions.createMerged({
    type: "saved-group",
    id: savedGroup.id,
    snapshot: savedGroup as unknown as Record<string, unknown>,
    proposedChanges: patchOps,
    bypass: approvalRequired && canBypass,
    title,
    revertedFrom: targetRevision.id,
  });

  try {
    await adapter.applyChanges(
      req.context,
      savedGroup as unknown as Record<string, unknown>,
      fieldsToUpdate,
      { isRevert: true },
    );
  } catch (e) {
    try {
      await req.context.models.revisions.deleteById(merged.id);
    } catch {
      // ignore — surface the original applyChanges error
    }
    throw e;
  }

  await dispatchSavedGroupRevisionEvent(req.context, merged, {
    type: "reverted",
  });

  return {
    revision: await toApiSavedGroupRevision(merged, req.context),
  };
});
