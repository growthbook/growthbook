import {
  archiveSavedGroupValidator,
  unarchiveSavedGroupValidator,
} from "shared/validators";
import { SavedGroupInterface } from "shared/types/saved-group";
import { resolveOwnerEmail } from "back-end/src/services/owner";
import {
  collectSavedGroupArchiveDependents,
  archiveDependentsGateMessage,
} from "back-end/src/services/archiveDependentsGuard";
import { ApiReqContext, ApiRequestLocals } from "back-end/types/api";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { canUseRestApiBypassSetting } from "back-end/src/api/features/reviewBypass";
import { getAdapter } from "back-end/src/revisions";
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

  // Aggregate publish gates into one structured 422 (same contract as the
  // revision-publish endpoints). Only the archive transition is guarded;
  // unarchiving never breaks a dependent.
  const gates: PublishGate[] = [];
  if (archived) {
    const dependents = await collectSavedGroupArchiveDependents(context, id);
    if (dependents.ids.length) {
      gates.push({
        type: "archive-dependents",
        severity: "warning",
        messages: [archiveDependentsGateMessage("Saved Group", dependents)],
        override: "ignoreWarnings",
        requiresPermission: null,
        resolution: null,
      });
    }
  }

  const { blocking, bypassed } = evaluatePublishGates(gates, {
    ignoreWarnings: context.ignoreWarnings,
    skipSchemaValidation: context.skipSchemaValidation,
    bypassApprovalPermission: adapter.canBypassApproval(context, savedGroup),
    restApiBypassesReviews: canUseRestApiBypassSetting(req),
    canForceMergeStaleBase: adapter.canBypassApproval(context, savedGroup),
  });
  if (blocking.length) {
    throw new PublishBlockedError(blocking);
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
