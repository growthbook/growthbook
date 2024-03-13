import { getFactTableValidator } from "@back-end/src/validators/openapi";
import { GetFactTableResponse } from "@back-end/types/openapi";
import {
  getFactTable as findFactTableById,
  toFactTableApiInterface,
} from "@back-end/src/models/FactTableModel";
import { createApiRequestHandler } from "@back-end/src/util/handler";

export const getFactTable = createApiRequestHandler(getFactTableValidator)(
  async (req): Promise<GetFactTableResponse> => {
    const factTable = await findFactTableById(req.context, req.params.id);
    if (!factTable) {
      throw new Error("Could not find factTable with that id");
    }

    return {
      factTable: toFactTableApiInterface(factTable),
    };
  }
);
