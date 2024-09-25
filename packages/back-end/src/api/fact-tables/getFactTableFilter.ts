import { GetFactTableFilterResponse } from "back-end/types/openapi";
import {
  getFactTable,
  toFactTableFilterApiInterface,
} from "back-end/src/models/FactTableModel";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getFactTableFilterValidator } from "back-end/src/validators/openapi";

export const getFactTableFilter = createApiRequestHandler(
  getFactTableFilterValidator
)(
  async (req): Promise<GetFactTableFilterResponse> => {
    const factTable = await getFactTable(req.context, req.params.factTableId);
    if (!factTable) {
      throw new Error("Could not find factTable with that id");
    }

    return {
      factTableFilter: toFactTableFilterApiInterface(factTable, req.params.id),
    };
  }
);
