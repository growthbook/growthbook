import { NO_ENVIRONMENT_BINDING } from "shared/permissions";
import { isEqual } from "lodash";
import { JsonPatchOperation, Revision } from "shared/enterprise";
import { SavedGroupInterface } from "shared/types/saved-group";
import {
  postSavedGroupRevisionRevertValidator,
  savedGroupUpdatableFieldsSchema,
} from "shared/validators";
import {
  revertRevision,
  resolveRevertStrategy,
} from "back-end/src/revisions/revertActions";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import { getAdapter } from "back-end/src/revisions";
import {
  applyPatchToSnapshot,
  ensureLiveRevisionExists,
} from "back-end/src/revisions/util";
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
  const revertsBypassApproval =
    !!req.organization.settings?.revertsBypassApproval;
  const strategy = resolveRevertStrategy(
    req.body.strategy,
    revertsBypassApproval,
  );

  // Coarse standing before the reconstruction; assertCanRevertRevision below is
  // authoritative once the change set is known. Subset-refusing.
  if (
    (["revert", "draft"] as const).every(
      (action) =>
        !req.context.permissions.canRevisionAction(
          "saved-group",
          action,
          savedGroup,
          NO_ENVIRONMENT_BINDING,
        ),
    )
  ) {
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
  // Authoritative: the revert atom, plus a relocation's destination and an archive
  // restore's delete atom. Saved Groups carry no environment footprint.

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

  const { revision: result } = await revertRevision({
    context: req.context,
    entityType: "saved-group",
    entity: savedGroup as unknown as Record<string, unknown> & { id: string },
    targetRevision,
    strategy,
    fields: fieldsToUpdate,
    patchOps,
    // Saved Groups are project-scoped throughout; no environment footprint.
    footprint: NO_ENVIRONMENT_BINDING,
    title,
    // Approval for this landing, resolved by the pipeline after authority.
    resolveApproval: async () => {
      // With "reverts bypass approval" enabled, a revert restores an
      // already-reviewed state and doesn't require approval at all, so it's a
      // normal merge rather than a recorded bypass.
      const approvalRequired = revertsBypassApproval
        ? false
        : adapter.isApprovalRequiredForRevision
          ? adapter.isApprovalRequiredForRevision(req.context, {
              target: { proposedChanges: patchOps },
            } as unknown as Revision)
          : adapter.isApprovalRequired(req.context);
      const canBypass =
        !!req.organization.settings?.restApiBypassesReviews ||
        adapter.canBypassApproval(
          req.context,
          savedGroup as Record<string, unknown>,
        );
      if (approvalRequired && !canBypass) {
        throw new BadRequestError(
          "This revert requires approval before changes can be published. " +
            'Use `strategy: "draft"` to create a draft for review, ' +
            "or use a role/token that grants bypassApprovalSavedGroups.",
        );
      }
      return { approvalRequired, canBypass };
    },
    // Re-archiving on landing soft-warns (bypassably) if live dependents remain.
    assertLandable: async () => {
      if (fieldsToUpdate.archived === true && !savedGroup.archived) {
        await assertSavedGroupArchiveDependentsGuard(
          req.context,
          { id: savedGroup.id },
          { armed: false },
        );
      }
    },
  });

  return {
    revision: await toApiSavedGroupRevision(result, req.context),
  };
});
