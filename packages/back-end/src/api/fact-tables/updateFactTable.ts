import { UpdateFactTableResponse } from "../../../types/openapi";
import {
  updateFactTable as updateFactTableInDb,
  toFactTableApiInterface,
  getFactTable,
} from "../../models/FactTableModel";
import { createApiRequestHandler } from "../../util/handler";
import { updateFactTableValidator } from "../../validators/openapi";

export const updateFactTable = createApiRequestHandler(
  updateFactTableValidator
)(
  async (req): Promise<UpdateFactTableResponse> => {
    const factTable = await getFactTable(req.organization.id, req.params.id);
    if (!factTable) {
      throw new Error("Could not find factTable with that id");
    }

    await updateFactTableInDb(factTable, req.body, req.eventAudit);

    return {
      factTable: toFactTableApiInterface({ ...factTable, ...req.body }),
    };
  }
);
