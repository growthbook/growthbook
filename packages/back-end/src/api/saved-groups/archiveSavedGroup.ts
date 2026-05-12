import { archiveSavedGroupValidator } from "shared/validators";
import { resolveOwnerEmail } from "back-end/src/services/owner";
import {
  loadSavedGroupReferences,
  totalSavedGroupReferences,
} from "back-end/src/services/savedGroups";
import { createApiRequestHandler } from "back-end/src/util/handler";

export const archiveSavedGroup = createApiRequestHandler(
  archiveSavedGroupValidator,
)(async (req) => {
  const { id } = req.params;

  const savedGroup = await req.context.models.savedGroups.getById(id);

  if (!savedGroup) {
    throw new Error(`Unable to locate the saved-group: ${id}`);
  }

  if (!req.context.permissions.canUpdateSavedGroup(savedGroup, savedGroup)) {
    req.context.permissions.throwPermissionError();
  }

  // Idempotent: if already archived, return current state without an extra write.
  if (savedGroup.archived) {
    return {
      savedGroup: await resolveOwnerEmail(
        req.context.models.savedGroups.toApiInterface(savedGroup),
        req.context,
      ),
    };
  }

  // Refuse to archive a group that's still referenced. Otherwise the archived
  // group would survive `filterUsedSavedGroups` in the SDK payload (which
  // filters by usage, not by archived state), defeating the purpose of
  // archiving. The front-end UI already enforces this; this is the equivalent
  // gate for REST API consumers.
  const refs = await loadSavedGroupReferences(req.context, id);
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

  const updated = await req.context.models.savedGroups.update(savedGroup, {
    archived: true,
  });

  const merged = { ...savedGroup, ...updated };
  return {
    savedGroup: await resolveOwnerEmail(
      req.context.models.savedGroups.toApiInterface(merged),
      req.context,
    ),
  };
});
