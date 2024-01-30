import { isProjectListValidForProject } from "shared/util";
import { ListFactTablesResponse } from "../../../types/openapi";
import {
  getAllFactTablesForOrganization,
  toFactTableApiInterface,
} from "../../models/FactTableModel";
import { applyPagination, createApiRequestHandler } from "../../util/handler";
import { listFactTablesValidator } from "../../validators/openapi";

export const listFactTables = createApiRequestHandler(listFactTablesValidator)(
  async (req): Promise<ListFactTablesResponse> => {
    const factTables = await getAllFactTablesForOrganization(req.context);

    let matches = factTables;
    if (req.query.projectId) {
      matches = matches.filter((factTable) =>
        isProjectListValidForProject(factTable.projects, req.query.projectId)
      );
    }
    if (req.query.datasourceId) {
      matches = matches.filter(
        (factTable) => factTable.datasource === req.query.datasourceId
      );
    }

    // TODO: Move sorting/limiting to the database query for better performance
    const { filtered, returnFields } = applyPagination(
      matches.sort((a, b) => a.id.localeCompare(b.id)),
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
