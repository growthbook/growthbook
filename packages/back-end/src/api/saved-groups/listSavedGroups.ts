import { ListSavedGroupsResponse } from "shared/types/openapi";
import { listSavedGroupsValidator } from "shared/validators";
import {
  applyPagination,
  createApiRequestHandler,
} from "back-end/src/util/handler";

export const listSavedGroups = createApiRequestHandler(
  listSavedGroupsValidator,
)(async (req): Promise<ListSavedGroupsResponse> => {
  const savedGroups = await req.context.models.savedGroups.getAll();

  // TODO: Move sorting/limiting to the database query for better performance
  const { filtered, returnFields } = applyPagination(
    savedGroups.sort((a, b) => a.id.localeCompare(b.id)),
    req.query,
  );

  return {
    savedGroups: filtered.map((savedGroup) =>
      req.context.models.savedGroups.toApiInterface(savedGroup),
    ),
    ...returnFields,
  };
});
