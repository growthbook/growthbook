import { ListVisualChangesetsResponse } from "../../../types/openapi";
import {
  findVisualChangesetsByOrganization,
  toVisualChangesetApiInterface,
} from "../../models/VisualChangesetModel";
import { applyPagination, createApiRequestHandler } from "../../util/handler";
import { listVisualChangesetsValidator } from "../../validators/openapi";

export const listVisualChangesets = createApiRequestHandler(
  listVisualChangesetsValidator
)(
  async (req): Promise<ListVisualChangesetsResponse> => {
    const visualChangesets = await findVisualChangesetsByOrganization(
      req.organization.id
    );

    // TODO: Move sorting/limiting to the database query for better performance
    const { filtered, returnFields } = applyPagination(
      visualChangesets.sort((a, b) => a.id.localeCompare(b.id)),
      req.query
    );

    return {
      visualChangesets: filtered.map((visualChangeset) =>
        toVisualChangesetApiInterface(visualChangeset)
      ),
      ...returnFields,
    };
  }
);
