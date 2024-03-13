import { getFactTableFilterValidator } from "@/src/validators/openapi";
import { GetFactTableFilterResponse } from "@/types/openapi";
import {
  getFactTable,
  toFactTableFilterApiInterface,
} from "@/src/models/FactTableModel";
import { createApiRequestHandler } from "@/src/util/handler";

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
