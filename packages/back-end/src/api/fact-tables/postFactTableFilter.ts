import { PostFactTableFilterResponse } from "../../../types/openapi";
import {
  createFactFilter,
  getFactTable,
  toFactTableFilterApiInterface,
} from "../../models/FactTableModel";
import { createApiRequestHandler } from "../../util/handler";
import { postFactTableFilterValidator } from "../../validators/openapi";

export const postFactTableFilter = createApiRequestHandler(
  postFactTableFilterValidator
)(
  async (req): Promise<PostFactTableFilterResponse> => {
    const factTable = await getFactTable(req.context, req.params.factTableId);
    if (!factTable) {
      throw new Error("Could not find factTable with that id");
    }
    req.checkPermissions("manageFactTables", factTable.projects);

    const filter = await createFactFilter(factTable, {
      description: "",
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
