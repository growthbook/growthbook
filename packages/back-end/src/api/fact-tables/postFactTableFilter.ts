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

    if (!req.context.permissions.canUpdateFactTable(factTable, {})) {
      req.context.permissions.throwPermissionError();
    }

    if (req.body.managedBy === "api" && !factTable.managedBy) {
      throw new Error(
        "Cannot set filter to be managed by api unless Fact Table is also managed by api"
      );
    }

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
