import {
  archiveSavedGroupValidator,
  unarchiveSavedGroupValidator,
} from "shared/validators";
import { SavedGroupInterface } from "shared/types/saved-group";
import { resolveOwnerEmail } from "back-end/src/services/owner";
import {
  loadSavedGroupReferences,
  totalSavedGroupReferences,
} from "back-end/src/services/savedGroups";
import { ApiReqContext } from "back-end/types/api";
import { createApiRequestHandler } from "back-end/src/util/handler";

async function buildResponse(
  context: ApiReqContext,
  savedGroup: SavedGroupInterface,
) {
  return {
    savedGroup: await resolveOwnerEmail(
      context.models.savedGroups.toApiInterface(savedGroup),
      context,
    ),
  };
}

async function setArchivedState(
  context: ApiReqContext,
  id: string,
  archived: boolean,
) {
  const savedGroup = await context.models.savedGroups.getById(id);

  if (!savedGroup) {
    throw new Error(`Unable to locate the saved-group: ${id}`);
  }

  if (!context.permissions.canUpdateSavedGroup(savedGroup, savedGroup)) {
    context.permissions.throwPermissionError();
  }

  // Idempotent: if already in the desired state, return without an extra write.
  if (!!savedGroup.archived === archived) {
    return buildResponse(context, savedGroup);
  }

  // When archiving, refuse if the saved group is still referenced. Same gate as
  // the internal PUT controller and the front-end SavedGroupArchiveModal — it
  // keeps the invariant that archived groups have no references, so they're
  // naturally excluded from the SDK payload's `filterUsedSavedGroups`. Only
  // the archive transition is blocked; unarchiving is always allowed.
  if (archived) {
    const refs = await loadSavedGroupReferences(context, id);
    if (refs && totalSavedGroupReferences(refs) > 0) {
      const parts: string[] = [];
      if (refs.features.length) {
        parts.push(`${refs.features.length} feature(s)`);
      }
      if (refs.experiments.length) {
        parts.push(`${refs.experiments.length} experiment(s)`);
      }
      if (refs.savedGroups.length) {
        parts.push(`${refs.savedGroups.length} other saved group(s)`);
      }
      throw new Error(
        `Cannot archive saved group: it is still referenced by ${parts.join(
          ", ",
        )}. Remove these references first.`,
      );
    }
  }

  const updated = await context.models.savedGroups.update(savedGroup, {
    archived,
  });

  return buildResponse(context, { ...savedGroup, ...updated });
}

export const archiveSavedGroup = createApiRequestHandler(
  archiveSavedGroupValidator,
)(async (req) => setArchivedState(req.context, req.params.id, true));

export const unarchiveSavedGroup = createApiRequestHandler(
  unarchiveSavedGroupValidator,
)(async (req) => setArchivedState(req.context, req.params.id, false));
