import { Revision } from "shared/enterprise";
import {
  archiveSavedGroupValidator,
  unarchiveSavedGroupValidator,
} from "shared/validators";
import { SavedGroupInterface } from "shared/types/saved-group";
import { resolveOwnerEmail } from "back-end/src/services/owner";
import { collectSavedGroupArchiveDependentsGate } from "back-end/src/services/archiveDependentsGuard";
import { landDirectChange } from "back-end/src/revisions/revertActions";
import { runGuardedWrite } from "back-end/src/revisions/landingSequence";
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
import { canLandArchivedState } from "back-end/src/revisions/archiveTransition";
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

  // Archiving is delete-class; unarchiving returns the group to service and is
  // an ordinary publish (project-scoped — saved groups have no environments).
  if (
    !canLandArchivedState({
      permissions: context.permissions,
      model: "saved-group",
      entity: savedGroup,
      archived,
    })
  ) {
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
      createDraftPath: `/saved-groups-revisions/${savedGroup.id}`,
      model: "saved-group",
    }),
    // Only the archive transition is guarded for dependents; unarchiving never
    // breaks a dependent.
    ...(await collectSavedGroupArchiveDependentsGate(context, savedGroup, {
      archived,
    })),
  ];

  const { blocking, bypassed } = evaluatePublishGates(gates, {
    ignoreWarnings: context.ignoreWarnings,
    skipSchemaValidation: context.canSkipSchemaValidationFor("saved-group"),
    skipHooks: context.canSkipHooksFor("saved-group"),
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
        `Use \`POST /saved-groups-revisions/${savedGroup.id}\` to ${
          archived ? "archive" : "unarchive"
        } it through a draft, or use a role/token with the bypass permission.`,
    );
  }

  // One recorded, guarded landing whether or not approval was bypassed.
  // History first, then live state: a merged record with no live change is
  // detectable and removable; a live change with no record cannot be repaired.
  await ensureLiveRevisionExists(
    context,
    "saved-group",
    savedGroup as unknown as Record<string, unknown> & {
      id: string;
      owner?: string;
      dateCreated?: Date;
    },
  );
  const { merged, result: updated } = await landDirectChange({
    context,
    entityType: "saved-group",
    entity: savedGroup as unknown as Record<string, unknown> & { id: string },
    patchOps,
    bypass: approvalRequired,
    changes: { archived },
    write: () =>
      runGuardedWrite("saved-group", savedGroup.id, () =>
        context.models.savedGroups.updateIfUnchanged(savedGroup, { archived }),
      ),
  });
  await dispatchSavedGroupRevisionEvent(context, merged, {
    type: "published",
  });
  return buildResponse(context, { ...savedGroup, ...updated }, bypassed);
}

export const archiveSavedGroup = createApiRequestHandler(
  archiveSavedGroupValidator,
)(async (req) => setArchivedState(req, req.params.id, true));

export const unarchiveSavedGroup = createApiRequestHandler(
  unarchiveSavedGroupValidator,
)(async (req) => setArchivedState(req, req.params.id, false));
