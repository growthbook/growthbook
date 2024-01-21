import { PostFactTableFilterResponse } from "../../../types/openapi";
import { getDataSourceById } from "../../models/DataSourceModel";
import {
  createFactFilter,
  getFactTable,
  toFactTableFilterApiInterface,
} from "../../models/FactTableModel";
import { testFilterQuery } from "../../routers/fact-table/fact-table.controller";
import { createApiRequestHandler } from "../../util/handler";
import { postFactTableFilterValidator } from "../../validators/openapi";

export const postFactTableFilter = createApiRequestHandler(
  postFactTableFilterValidator
)(
  async (req): Promise<PostFactTableFilterResponse> => {
    const factTable = await getFactTable(
      req.organization.id,
      req.params.factTableId
    );
    if (!factTable) {
      throw new Error("Could not find factTable with that id");
    }
    req.checkPermissions("manageFactTables", factTable.projects);

    const datasource = await getDataSourceById(
      factTable.datasource,
      req.organization.id
    );
    if (!datasource) {
      throw new Error("Could not find datasource");
    }
    req.checkPermissions("runQueries", datasource.projects || "");

    const result = await testFilterQuery(datasource, factTable, req.body.value);

    if (result.error) {
      throw new Error(result.error);
    }

    const filter = await createFactFilter(factTable, {
      description: "",
      managedBy: "",
      ...req.body,
    });

    return {
      factTableFilter: toFactTableFilterApiInterface(
        {
          ...factTable,
          filters: [...factTable.filters, filter],
        },
        filter.id
      ),
    };
  }
);
