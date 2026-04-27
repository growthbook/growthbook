import { listSavedGroupsValidator } from "shared/validators";
import { resolveOwnerEmails } from "back-end/src/services/owner";
import {
  applyPagination,
  createApiRequestHandler,
} from "back-end/src/util/handler";

export const listSavedGroups = createApiRequestHandler(
  listSavedGroupsValidator,
)(async (req) => {
  const savedGroups = await req.context.models.savedGroups.getAll();

  // TODO: Move sorting/limiting to the database query for better performance
  const { filtered, returnFields } = applyPagination(
    savedGroups.sort((a, b) => a.id.localeCompare(b.id)),
    req.query,
  );

  return {
    savedGroups: await resolveOwnerEmails(
      filtered.map((savedGroup) =>
        req.context.models.savedGroups.toApiInterface(savedGroup),
      ),
      req.context,
    ),
    ...returnFields,
  };
});
