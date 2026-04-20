import { getFactTableValidator } from "shared/validators";
import {
  getFactTable as findFactTableById,
  toFactTableApiInterface,
} from "back-end/src/models/FactTableModel";
import { buildOwnerEmailMap } from "back-end/src/services/ownerEmail";
import { createApiRequestHandler } from "back-end/src/util/handler";

export const getFactTable = createApiRequestHandler(getFactTableValidator)(
  async (req) => {
    const factTable = await findFactTableById(req.context, req.params.id);
    if (!factTable) {
      throw new Error("Could not find factTable with that id");
    }

    const ownerEmailMap = await buildOwnerEmailMap([factTable.owner]);
    return {
      factTable: toFactTableApiInterface(factTable, ownerEmailMap),
    };
  },
);
