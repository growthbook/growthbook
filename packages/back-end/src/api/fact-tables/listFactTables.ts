import { ListFactTablesResponse } from "../../../types/openapi";
import {
  getAllFactTablesForOrganization,
  toFactTableApiInterface,
} from "../../models/FactTableModel";
import { applyPagination, createApiRequestHandler } from "../../util/handler";
import { listFactTablesValidator } from "../../validators/openapi";

export const listFactTables = createApiRequestHandler(listFactTablesValidator)(
  async (req): Promise<ListFactTablesResponse> => {
    const factTables = await getAllFactTablesForOrganization(
      req.organization.id
    );

    // TODO: Move sorting/limiting to the database query for better performance
    const { filtered, returnFields } = applyPagination(
      factTables.sort((a, b) => a.id.localeCompare(b.id)),
      req.query
    );

    return {
      factTables: filtered.map((factTable) =>
        toFactTableApiInterface(factTable)
      ),
      ...returnFields,
    };
  }
);
