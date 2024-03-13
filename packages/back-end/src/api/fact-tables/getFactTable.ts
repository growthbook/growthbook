import { getFactTableValidator } from "@/src/validators/openapi";
import { GetFactTableResponse } from "@/types/openapi";
import {
  getFactTable as findFactTableById,
  toFactTableApiInterface,
} from "@/src/models/FactTableModel";
import { createApiRequestHandler } from "@/src/util/handler";

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
