import { ListFactTablesResponse } from "shared/types/openapi";
import { listFactTablesValidator } from "shared/validators";
import {
  getAllFactTablesForOrganization,
  toFactTableApiInterface,
} from "back-end/src/models/FactTableModel";
import {
  applyPagination,
  createApiRequestHandler,
} from "back-end/src/util/handler";

export const listFactTables = createApiRequestHandler(listFactTablesValidator)(
  async (req): Promise<ListFactTablesResponse> => {
    // Filter at the database level for better performance
    const factTables = await getAllFactTablesForOrganization(req.context, {
      datasourceId: req.query.datasourceId,
      projectId: req.query.projectId,
    });

    // Sorting is done at DB level
    // TODO: Move pagination (limit/offset) to database for better performance
    const { filtered, returnFields } = applyPagination(factTables, req.query);

    return {
      factTables: filtered.map((factTable) =>
        toFactTableApiInterface(factTable),
      ),
      ...returnFields,
    };
  },
);
