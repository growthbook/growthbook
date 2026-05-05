import { getFactTableValidator } from "shared/validators";
import {
  getFactTable as findFactTableById,
  toFactTableApiInterface,
} from "back-end/src/models/FactTableModel";
import { resolveOwnerEmail } from "back-end/src/services/owner";
import { createApiRequestHandler } from "back-end/src/util/handler";

export const getFactTable = createApiRequestHandler(getFactTableValidator)(
  async (req) => {
    const factTable = await findFactTableById(req.context, req.params.id);
    if (!factTable) {
      throw new Error("Could not find factTable with that id");
    }

    return {
      factTable: await resolveOwnerEmail(
        toFactTableApiInterface(factTable),
        req.context,
      ),
    };
  },
);
