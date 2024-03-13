import { listSavedGroupsValidator } from "@/src/validators/openapi";
import { ListSavedGroupsResponse } from "@/types/openapi";
import {
  getAllSavedGroups,
  toSavedGroupApiInterface,
} from "@/src/models/SavedGroupModel";
import { applyPagination, createApiRequestHandler } from "@/src/util/handler";

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
