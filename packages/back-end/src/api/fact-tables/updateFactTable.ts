import { UpdateFactTableProps } from "../../../types/fact-table";
import { UpdateFactTableResponse } from "../../../types/openapi";
import { queueFactTableColumnsRefresh } from "../../jobs/refreshFactTableColumns";
import {
  updateFactTable as updateFactTableInDb,
  toFactTableApiInterface,
  getFactTable,
} from "../../models/FactTableModel";
import { addTagsDiff } from "../../models/TagModel";
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
    req.checkPermissions("manageFactTables", factTable.projects);
    if (req.body.projects) {
      req.checkPermissions("manageFactTables", req.body.projects);
    }

    const data: UpdateFactTableProps = { ...req.body };

    await updateFactTableInDb(factTable, data, req.eventAudit);
    await queueFactTableColumnsRefresh(factTable);

    if (data.tags) {
      await addTagsDiff(req.organization.id, factTable.tags, data.tags);
    }

    return {
      factTable: toFactTableApiInterface({ ...factTable, ...req.body }),
    };
  }
);
