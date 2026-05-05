import { listFactTablesValidator } from "shared/validators";
import {
  getAllFactTablesForOrganization,
  toFactTableApiInterface,
} from "back-end/src/models/FactTableModel";
import { resolveOwnerEmails } from "back-end/src/services/owner";
import {
  applyPagination,
  createApiRequestHandler,
} from "back-end/src/util/handler";

export const listFactTables = createApiRequestHandler(listFactTablesValidator)(
  async (req) => {
    // Filter at the database level for better performance
    const factTables = await getAllFactTablesForOrganization(req.context, {
      datasourceId: req.query.datasourceId,
      projectId: req.query.projectId,
    });

    // Sorting is done at DB level
    // TODO: Move pagination (limit/offset) to database for better performance
    const { filtered, returnFields } = applyPagination(factTables, req.query);

    return {
      factTables: await resolveOwnerEmails(
        filtered.map((factTable) => toFactTableApiInterface(factTable)),
        req.context,
      ),
      ...returnFields,
    };
  },
);
