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

  const strategy = req.body.strategy ?? "draft";
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
    approvalRequired = adapter.isApprovalRequiredForRevision
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

  // Always create a fresh revision for revert — even in `publish` mode — so
  // there's a clear audit-log entry of the revert, distinct from any other
  // pending draft from the same author.
  const draft = await createOrUpdateRevision(
    req.context,
    "saved-group",
    savedGroup as unknown as Record<string, unknown> & { id: string },
    patchOps,
    {
      forceCreate: true,
      title: req.body.title ?? defaultTitle,
      revertedFrom: targetRevision.id,
    },
  );

  if (!isPublish) {
    return {
      revision: await toApiSavedGroupRevision(draft, req.context),
    };
  }

  // Apply changes immediately, then mark the freshly created draft as merged.
  await adapter.applyChanges(
    req.context,
    savedGroup as unknown as Record<string, unknown>,
    fieldsToUpdate,
  );

  const merged = await req.context.models.revisions.merge(
    draft.id,
    req.context.userId,
    {
      bypass: approvalRequired && canBypass,
    },
  );

  return {
    revision: await toApiSavedGroupRevision(merged, req.context),
  };
});
