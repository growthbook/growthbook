import { archiveSavedGroupValidator } from "shared/validators";
import { resolveOwnerEmail } from "back-end/src/services/owner";
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
