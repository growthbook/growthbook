import { Revision } from "shared/enterprise";
import {
  archiveSavedGroupValidator,
  unarchiveSavedGroupValidator,
} from "shared/validators";
import { SavedGroupInterface } from "shared/types/saved-group";
import { resolveOwnerEmail } from "back-end/src/services/owner";
import { collectSavedGroupArchiveDependentsGate } from "back-end/src/services/archiveDependentsGuard";
import { collectArchiveApprovalGate } from "back-end/src/revisions/governanceGates";
import { ApiReqContext, ApiRequestLocals } from "back-end/types/api";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { canUseRestApiBypassSetting } from "back-end/src/api/features/reviewBypass";
import { BadRequestError } from "back-end/src/util/errors";
import { getAdapter } from "back-end/src/revisions";
import {
  buildPatchOps,
  ensureLiveRevisionExists,
} from "back-end/src/revisions/util";
import { dispatchSavedGroupRevisionEvent } from "back-end/src/services/savedGroupRevisionEvents";
import {
  evaluatePublishGates,
  PublishBlockedError,
  PublishGate,
  BypassedGate,
} from "back-end/src/revisions/publishGates";

async function buildResponse(
  context: ApiReqContext,
  savedGroup: SavedGroupInterface,
  bypassed: BypassedGate[],
) {
  return {
    savedGroup: await resolveOwnerEmail(
      context.models.savedGroups.toApiInterface(savedGroup),
      context,
    ),
    ...(bypassed.length ? { bypassedGates: bypassed } : {}),
  };
}

async function setArchivedState(
  req: Pick<ApiRequestLocals, "context" | "isJwtAuth">,
  id: string,
  archived: boolean,
) {
  const { context } = req;
  const savedGroup = await context.models.savedGroups.getById(id);

  if (!savedGroup) {
    throw new Error(`Unable to locate the saved-group: ${id}`);
  }

  if (!context.permissions.canUpdateSavedGroup(savedGroup, savedGroup)) {
    context.permissions.throwPermissionError();
  }

  // Idempotent: if already in the desired state, return without an extra write.
  if (!!savedGroup.archived === archived) {
    return buildResponse(context, savedGroup, []);
  }

  const adapter = getAdapter("saved-group");
  const patchOps = buildPatchOps({ archived });
  // `archived` is a saved-group metadata field, so this transition still needs
  // review when the org requires it (respecting the adapter's metadata-review
  // shortcut) — matching the archive-through-a-draft flow and the config/constant
  // archive endpoints. Without this an editor could archive/unarchive past a
  // required review.
  const approvalRequired = adapter.isApprovalRequiredForRevision
    ? adapter.isApprovalRequiredForRevision(context, {
        target: { snapshot: savedGroup, proposedChanges: patchOps },
      } as unknown as Revision)
    : adapter.isApprovalRequired(context);
  const canBypass =
    canUseRestApiBypassSetting(req) ||
    adapter.canBypassApproval(context, savedGroup);

  // Aggregate publish gates into one structured 422 (same contract as the
  // revision-publish endpoints).
  const gates: PublishGate[] = [
    ...collectArchiveApprovalGate({
      approvalRequired,
      archived,
      noun: "Saved Group",
      createDraftPath: `/saved-groups/${savedGroup.id}/revisions`,
    }),
    // Only the archive transition is guarded for dependents; unarchiving never
    // breaks a dependent.
    ...(await collectSavedGroupArchiveDependentsGate(context, savedGroup, {
      archived,
    })),
  ];

  const { blocking, bypassed } = evaluatePublishGates(gates, {
    ignoreWarnings: context.ignoreWarnings,
    skipSchemaValidation: context.skipSchemaValidation,
    skipHooks: context.skipHooks,
    bypassApprovalPermission: adapter.canBypassApproval(context, savedGroup),
    restApiBypassesReviews: canUseRestApiBypassSetting(req),
    canForceMergeStaleBase: adapter.canBypassApproval(context, savedGroup),
  });
  if (blocking.length) {
    throw new PublishBlockedError(blocking);
  }

  // Approval backstop behind the gate above.
  if (approvalRequired && !canBypass) {
    throw new BadRequestError(
      "This organization requires approvals on saved groups. " +
        `Use \`POST /saved-groups/${savedGroup.id}/revisions\` to ${
          archived ? "archive" : "unarchive"
        } it through a draft, or use a role/token with the bypass permission.`,
    );
  }

  if (approvalRequired) {
    // Record the bypass as a merged revision (activity log) — persist the live
    // change first, then the revision, mirroring updateSavedGroup so a failed
    // revision write never strands the change.
    await ensureLiveRevisionExists(
      context,
      "saved-group",
      savedGroup as unknown as Record<string, unknown> & {
        id: string;
        owner?: string;
        dateCreated?: Date;
      },
    );
    const updated = await context.models.savedGroups.update(savedGroup, {
      archived,
    });
    const merged = await context.models.revisions.createMerged({
      type: "saved-group",
      id: savedGroup.id,
      snapshot: savedGroup as unknown as Record<string, unknown>,
      proposedChanges: patchOps,
      bypass: true,
    });
    await dispatchSavedGroupRevisionEvent(context, merged, {
      type: "published",
    });
    return buildResponse(context, { ...savedGroup, ...updated }, bypassed);
  }

  const updated = await context.models.savedGroups.update(savedGroup, {
    archived,
  });
  return buildResponse(context, { ...savedGroup, ...updated }, bypassed);
}

export const archiveSavedGroup = createApiRequestHandler(
  archiveSavedGroupValidator,
)(async (req) => setArchivedState(req, req.params.id, true));

export const unarchiveSavedGroup = createApiRequestHandler(
  unarchiveSavedGroupValidator,
)(async (req) => setArchivedState(req, req.params.id, false));
