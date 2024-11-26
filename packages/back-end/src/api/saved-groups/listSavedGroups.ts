import { ListSavedGroupsResponse } from "back-end/types/openapi";
import {
  getAllSavedGroups,
  toSavedGroupApiInterface,
} from "back-end/src/models/SavedGroupModel";
import {
  applyPagination,
  createApiRequestHandler,
} from "back-end/src/util/handler";
import { listSavedGroupsValidator } from "back-end/src/validators/openapi";

export const listSavedGroups = createApiRequestHandler(
  listSavedGroupsValidator
)(
  async (req): Promise<ListSavedGroupsResponse> => {
    const savedGroups = await getAllSavedGroups(req.organization.id);

    // TODO: Move sorting/limiting to the database query for better performance
    const { filtered, returnFields } = applyPagination(
      savedGroups.sort((a, b) => a.id.localeCompare(b.id)),
      req.query
    );

    return {
      savedGroups: filtered.map((savedGroup) =>
        toSavedGroupApiInterface(savedGroup)
      ),
      ...returnFields,
    };
  }
);
