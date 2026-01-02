import { GetFactTableResponse } from "shared/types/openapi";
import { getFactTableValidator } from "shared/validators";
import {
  getFactTable as findFactTableById,
  toFactTableApiInterface,
} from "back-end/src/models/FactTableModel";
import { createApiRequestHandler } from "back-end/src/util/handler";

export const getFactTable = createApiRequestHandler(getFactTableValidator)(
  async (req): Promise<GetFactTableResponse> => {
    const factTable = await findFactTableById(req.context, req.params.id);
    if (!factTable) {
      throw new Error("Could not find factTable with that id");
    }

    return {
      factTable: toFactTableApiInterface(factTable),
    };
  },
);
