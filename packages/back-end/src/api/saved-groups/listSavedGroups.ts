import { listSavedGroupsValidator } from "shared/validators";
import { buildOwnerEmailMap } from "back-end/src/services/ownerEmail";
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

  const ownerEmailMap = await buildOwnerEmailMap(filtered.map((s) => s.owner));
  return {
    savedGroups: filtered.map((savedGroup) =>
      req.context.models.savedGroups.toApiInterface(savedGroup, ownerEmailMap),
    ),
    ...returnFields,
  };
});
